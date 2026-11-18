"""MAR IA — serviço FastAPI.

A conversa da MARIA roda no agente ElevenLabs publicado — este serviço
expõe as ferramentas (MCP stateless) e emite a sessão segura.

Endpoints:
  GET  /healthz             → status + pendências de configuração
  GET  /readyz              → pronto para tráfego
  GET  /metrics             → latências p50/p95 + contadores (JSON)
  GET  /metrics.prom        → mesmas métricas no formato Prometheus
  POST /api/maria/session   → signed_url ElevenLabs p/ o funcionário
  POST /mcp                 → tools MCP (Bearer JWT do funcionário)
  POST /ia/resposta-avaliacao, /ia/concierge → Inná (hóspedes)
"""
import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse

from .config import get_settings
from .infra.storage import get_store
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
        log.info("MAR IA pronto — agente elevenlabs=%s", s.elevenlabs_agent_id)
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
    # Backup do Postgres — gate próprio (BACKUP_DATABASE_URL + bucket),
    # independente do backup do data/ acima.
    from .infra import pg_backup
    if pg_backup.backup_pg_habilitado():
        tarefas.append(
            asyncio.create_task(pg_backup.backup_pg_periodico()))
        log.info("backup pg agendado — janela diária ~%02d:00 UTC",
                 pg_backup._HORA_UTC)
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


# Routers registrados após o app existir (import tardio intencional).
from .mcp import router as mcp_router  # noqa: E402
from .rotas_backup import router as backup_router  # noqa: E402
from .rotas_eleven import router as eleven_router  # noqa: E402
from .rotas_ia import router as ia_router  # noqa: E402

app.include_router(ia_router)
app.include_router(mcp_router)
app.include_router(eleven_router)
app.include_router(backup_router)


@app.get("/healthz")
async def healthz():
    from .infra.resilience import circuitos

    s = get_settings()
    return {
        "status": "ok",
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


if __name__ == "__main__":
    import uvicorn

    s = get_settings()
    uvicorn.run("app.main:app", host=s.maria_host, port=s.maria_port, reload=False)
