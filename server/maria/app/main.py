"""MAR IA — serviço FastAPI.

Endpoints:
  GET  /healthz      → status + pendências de configuração
  GET  /metrics      → latências p50/p95 por estágio
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
import json
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware

from .auth import validar_token, AuthError
from .config import get_settings
from .metrics import Latencia
from .session import MariaSession

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
    yield


app = FastAPI(title="MAR IA", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
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
    return Latencia.resumo()


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
