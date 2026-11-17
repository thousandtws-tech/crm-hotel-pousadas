"""MAR IA — serviço FastAPI.

Endpoints:
  GET  /healthz      → status + pendências de configuração
  GET  /readyz       → pronto para tráfego
  GET  /metrics      → latências p50/p95 + contadores (JSON)
  GET  /metrics.prom → mesmas métricas no formato Prometheus
  WS   /ws/maria?token=<jwt>  → sessão de voz/texto

Protocolo WS:
  Cliente → serviço
    binário            → áudio PCM16 24 kHz mono (entrada do microfone)
    {"type":"text"}    → pergunta digitada
    {"type":"commit"}  → fim de fala manual (quando server_vad off)
    {"type":"interrupt"} → barge-in: para a fala atual
    {"type":"confirm","idacao"} → confirma ação preparada
    {"type":"reset"}   → limpa o turno atual
  Serviço → cliente
    binário            → áudio PCM16 24 kHz da voz do MAR IA
    state / transcript / assistant_delta / assistant_done
    tool / action_required / action_done / error / hello / pong
"""
import asyncio
import json
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse

from .config import get_settings
from .infra.auth import AuthError, validar_token
from .infra.storage import get_store
from .runtime.session import MariaSession
from .telemetry.metrics import (
    Latencia,
    persistir_metricas,
    prometheus,
    restaurar_metricas,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("maria")


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    pend = s.validate_runtime()
    if pend:
        log.warning("configuração incompleta: %s", ", ".join(pend))
    else:
        log.info("MAR IA pronto — voz=%s model=%s", s.maria_voice_enabled, s.openai_llm_model)
    store = get_store()
    await restaurar_metricas(store)
    # Sonda o estado compartilhado no boot — Redis indisponível cai
    # para memória com log aqui, não no primeiro turno do usuário.
    from .infra.state import get_state
    await get_state()

    async def _salvar_periodico() -> None:
        while True:
            await asyncio.sleep(60)
            await persistir_metricas(store)

    tarefa = asyncio.create_task(_salvar_periodico())
    tarefas = [tarefa]
    if s.maria_backup_enabled and s.maria_s3_bucket:
        from .infra.backup import backup_periodico
        tarefas.append(asyncio.create_task(backup_periodico(store)))
    try:
        yield
    finally:
        for t in tarefas:
            t.cancel()
        await persistir_metricas(store)
        await store.fechar()


app = FastAPI(title="Maria", lifespan=lifespan)

# Tracing OTel — no-op quando OTEL_ENDPOINT está vazio.
from .telemetry.tracing import init_tracing  # noqa: E402

init_tracing(app)

# Sentry — no-op quando SENTRY_DSN está vazio. before_send remove JWTs
# (o WS carrega ?token=) e headers de auth antes de enviar o evento.
_s = get_settings()
if _s.sentry_dsn:
    try:
        import re

        import sentry_sdk

        _TOKEN_QS = re.compile(r"([?&]token=)[^&\s]+")

        def _scrub(event: dict) -> dict:
            req = event.get("request") or {}
            if isinstance(req.get("url"), str):
                req["url"] = _TOKEN_QS.sub(r"\1[redacted]", req["url"])
            if isinstance(req.get("query_string"), str):
                req["query_string"] = _TOKEN_QS.sub(
                    r"\1[redacted]", req["query_string"])
            headers = req.get("headers") or {}
            for h in ("authorization", "cookie"):
                if h in headers:
                    headers[h] = "[redacted]"
            return event

        sentry_sdk.init(
            dsn=_s.sentry_dsn,
            environment=_s.otel_service_name,
            send_default_pii=False,
            before_send=_scrub,
        )
        log.info("sentry ativo")
    except ImportError:
        log.warning("SENTRY_DSN configurada mas sentry-sdk ausente")
    except Exception:
        log.exception("falha ao iniciar sentry — seguindo sem")

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


# Routers registrados após o app existir (import tardio intencional).
from .mcp import router as mcp_router  # noqa: E402
from .rotas_ia import router as ia_router  # noqa: E402

app.include_router(ia_router)
app.include_router(mcp_router)


@app.get("/healthz")
async def healthz():
    from .infra.resilience import circuitos

    s = get_settings()
    return {
        "status": "ok",
        "voz": s.maria_voice_enabled,
        "config_pendente": s.validate_runtime(),
        "circuitos": circuitos(),
    }


@app.get("/readyz")
async def readyz():
    s = get_settings()
    pend = s.validate_runtime()
    return {"ready": not pend, "pendente": pend}


@app.get("/metrics")
async def metrics():
    from .telemetry.metrics import Uso
    return {"latencias": Latencia.resumo(), "uso": Uso.resumo()}


@app.get("/metrics.prom", response_class=PlainTextResponse)
async def metrics_prom():
    return prometheus()


@app.websocket("/ws/maria")
async def ws_maria(ws: WebSocket, token: str = Query(default="")):
    s = get_settings()
    if not s.openai_api_key:
        await ws.close(code=1011, reason="OPENAI_API_KEY ausente")
        return
    try:
        ator = await validar_token(token)
    except AuthError:
        await ws.close(code=4401, reason="não autenticado")
        return

    await ws.accept()
    session = MariaSession(ws, ator, token)
    log.info("sessão iniciada — %s (nível %s)", ator.login, ator.nivel)

    try:
        await session.iniciar()
        await session.saudar()
        while True:
            msg = await ws.receive()
            if msg["type"] == "websocket.disconnect":
                break
            if msg.get("bytes"):
                await session.on_audio(msg["bytes"])
            elif msg.get("text"):
                try:
                    await session.on_control(json.loads(msg["text"]))
                except json.JSONDecodeError:
                    continue
    except WebSocketDisconnect:
        pass
    except Exception:
        log.exception("sessão falhou")
    finally:
        await session.encerrar()
        log.info("sessão encerrada — %s", ator.login)


if __name__ == "__main__":
    import uvicorn

    s = get_settings()
    uvicorn.run("app.main:app", host=s.maria_host, port=s.maria_port, reload=False)
