"""Sessão da MARIA na ElevenLabs — o frontend pede uma signed_url
autenticado com o JWT do funcionário e o WebSocket da conversa abre
direto no navegador. A ELEVENLABS_API_KEY nunca sai do serviço."""

import logging

import httpx
from fastapi import APIRouter, Header, HTTPException

from .config import get_settings
from .infra.auth import AuthError, validar_token

log = logging.getLogger("maria.eleven")

router = APIRouter(prefix="/api/maria", tags=["maria"])

_SIGNED_URL = "https://api.elevenlabs.io/v1/convai/conversation/get-signed-url"


@router.post("/session")
async def criar_sessao(authorization: str | None = Header(default=None)):
    """Emite a signed_url de conversação da MARIA para o funcionário.

    O token valida identidade + nível — o agente fala em nome daquele
    usuário e as tools executam com as permissões dele via /mcp.
    """
    token = (authorization or "").removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(401, "token ausente")
    try:
        ator = await validar_token(token)
    except AuthError as exc:
        raise HTTPException(401, str(exc)) from exc

    s = get_settings()
    if not s.elevenlabs_api_key or not s.elevenlabs_agent_id:
        raise HTTPException(
            503, "ELEVENLABS_API_KEY / ELEVENLABS_AGENT_ID ausentes")

    try:
        async with httpx.AsyncClient(timeout=10) as cli:
            r = await cli.get(
                _SIGNED_URL,
                params={"agent_id": s.elevenlabs_agent_id},
                headers={"xi-api-key": s.elevenlabs_api_key},
            )
    except httpx.HTTPError as exc:
        log.warning("elevenlabs get-signed-url falhou: %s", exc)
        raise HTTPException(502, "ElevenLabs indisponível") from exc
    if r.status_code != 200:
        # O corpo pode repetir a chave — só o código vai pro erro.
        log.warning("elevenlabs get-signed-url HTTP %s", r.status_code)
        raise HTTPException(502, f"ElevenLabs recusou: HTTP {r.status_code}")

    signed_url = r.json().get("signed_url")
    if not signed_url:
        raise HTTPException(502, "ElevenLabs respondeu sem signed_url")

    log.info("sessão elevenlabs emitida — %s (nível %s)",
             ator.login, ator.nivel)
    return {
        "signed_url": signed_url,
        "agent_id": s.elevenlabs_agent_id,
        "funcionario": ator.login,
    }
