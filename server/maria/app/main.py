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


app = FastAPI(title="MAR IA", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.get("/healthz")
async def healthz():
    s = get_settings()
    return {
        "status": "ok",
        "voz": s.maria_voice_enabled,
        "config_pendente": s.validate_runtime(),
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
