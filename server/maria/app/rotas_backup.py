"""Ops de backup — gatilho manual e status (somente admin).

A janela diária (~04:00 UTC + intervalo) continua no lifespan; estas rotas
existem para verificação operacional — provar que bucket/credenciais/DSN
estão corretos sem esperar o agendamento, e para DR fora de hora.

Nunca loga nem retorna segredos: bucket/endpoint/prefixo vão na resposta,
DSN e chaves nunca.
"""
from fastapi import APIRouter, Header, HTTPException

from .config import get_settings
from .infra import pg_backup
from .infra.auth import AuthError, validar_token
from .infra.backup import backup_agora

router = APIRouter(prefix="/backup", tags=["backup"])


async def _exigir_admin(authorization: str | None):
    token = (authorization or "").removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(401, "token ausente")
    try:
        ator = await validar_token(token)
    except AuthError as exc:
        raise HTTPException(401, str(exc)) from exc
    if not ator.admin:
        raise HTTPException(403, "apenas admin")
    return ator


def _responder(stats: dict):
    if not stats.get("ok"):
        raise HTTPException(503, stats.get("motivo", "backup falhou"))
    return stats


@router.get("/status")
async def backup_status(authorization: str | None = Header(default=None)):
    """Configuração ativa e gates — para conferir o deploy sem disparar."""
    await _exigir_admin(authorization)
    s = get_settings()
    return {
        "pg": {
            "habilitado": pg_backup.backup_pg_habilitado(),
            "dsn_configurada": bool(s.backup_database_url),
        },
        "dados": {
            "habilitado": s.maria_backup_enabled and bool(s.maria_s3_bucket),
            "flag": s.maria_backup_enabled,
        },
        "s3": {
            "endpoint": s.maria_s3_endpoint or "aws",
            "bucket": s.maria_s3_bucket or None,
            "prefixo": s.maria_s3_prefix,
            "retain": s.maria_backup_retain,
            "intervalo_h": s.maria_backup_interval_h,
        },
    }


@router.post("/pg")
async def backup_pg_manual(authorization: str | None = Header(default=None)):
    """pg_dump → gzip → s3://BUCKET/backups/pg/ agora (admin)."""
    await _exigir_admin(authorization)
    return _responder(await pg_backup.backup_pg_agora())


@router.post("/dados")
async def backup_dados_manual(authorization: str | None = Header(default=None)):
    """Export do store + data/ → s3://BUCKET/PREFIX/<dia>/ agora (admin)."""
    await _exigir_admin(authorization)
    return _responder(await backup_agora())
