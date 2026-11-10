"""Endpoints HTTP stateless da Inná — mesma autenticação JWT do WebSocket,
mas sem sessão: uma chamada autenticada, uma resposta. Cobre os fluxos
pontuais de IA (resposta pública de avaliação hoje; concierge depois)."""

from fastapi import APIRouter, Header, HTTPException
from openai import AsyncOpenAI
from pydantic import BaseModel, Field

from .config import get_settings
from .infra.auth import AuthError, validar_token

router = APIRouter(prefix="/ia", tags=["ia"])

PROMPT_AVALIACAO = """Você é a Inná, gerente de relacionamento da pousada.
Escreva uma RESPOSTA PÚBLICA curta (2 a 4 frases) para a avaliação abaixo,
em português brasileiro, com tom profissional e caloroso de hotelaria.
Regras:
- Agradeça pelo nome se informado; nunca invente fatos que o hóspede não disse.
- Nota alta (>=4): agradeça, destaque o ponto forte citado e convide a voltar.
- Nota baixa (<=2) ou NPS <=6: peça desculpas sinceras, reconheça o problema
  específico, diga que a equipe foi acionada e ofereça contato direto.
- Nunca prometa reembolso, desconto ou fatos não confirmados.
- Sem markdown, sem título, no máximo um emoji."""


class RespostaAvaliacaoIn(BaseModel):
    hospede: str | None = None
    nota: int = Field(ge=1, le=5)
    nps: int | None = Field(default=None, ge=0, le=10)
    comentario: str = ""
    categorias: dict[str, int] = {}


async def _exigir_ator(authorization: str | None):
    token = (authorization or "").removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(401, "token ausente")
    try:
        return await validar_token(token)
    except AuthError as exc:
        raise HTTPException(401, str(exc)) from exc


def _cliente(s):
    return AsyncOpenAI(
        api_key=s.openai_api_key,
        timeout=s.openai_timeout_secs,
        max_retries=s.openai_max_retries,
    )


@router.post("/resposta-avaliacao")
async def resposta_avaliacao(
    body: RespostaAvaliacaoIn,
    authorization: str | None = Header(default=None),
):
    s = get_settings()
    if not s.openai_api_key:
        raise HTTPException(503, "OPENAI_API_KEY ausente")
    await _exigir_ator(authorization)

    cats = "; ".join(f"{k}: {v}/5" for k, v in body.categorias.items()) or "—"
    prompt = (
        f"Hóspede: {body.hospede or 'hóspede'}\n"
        f"Nota geral: {body.nota}/5\n"
        f"NPS: {body.nps if body.nps is not None else '—'}/10\n"
        f"Categorias: {cats}\n"
        f"Comentário: {body.comentario or '(sem comentário)'}"
    )
    try:
        resp = await _cliente(s).responses.create(
            model=s.openai_llm_model,
            instructions=PROMPT_AVALIACAO,
            input=prompt,
        )
        texto = (getattr(resp, "output_text", "") or "").strip()
    except Exception as exc:  # APIError, timeout, rate limit…
        raise HTTPException(502, f"LLM indisponível: {exc}") from exc
    if not texto:
        raise HTTPException(502, "LLM retornou resposta vazia")
    return {"resposta": texto}
