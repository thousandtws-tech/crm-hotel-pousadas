"""Endpoints HTTP stateless da Maria — mesma autenticação JWT do WebSocket,
mas sem sessão: uma chamada autenticada, uma resposta. Cobre os fluxos
pontuais de IA (resposta pública de avaliação e concierge do hóspede)."""

import json
import secrets

from fastapi import APIRouter, Header, HTTPException
from openai import AsyncOpenAI
from pydantic import BaseModel, Field

from .config import get_settings
from .infra.auth import AuthError, validar_token

router = APIRouter(prefix="/ia", tags=["ia"])

PROMPT_AVALIACAO = """Você é a Maria, gerente de relacionamento da pousada.
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


# ---------------------------------------------------------------------------
# Concierge do hóspede — chamado pelo backend Rust (chave interna, nunca
# pelo token do hóspede). Escopo restrito: só responde com os fatos do
# contexto; qualquer coisa fora disso vira escalada pra recepção.
# ---------------------------------------------------------------------------

PROMPT_CONCIERGE = """Você é a Maria, concierge virtual da pousada, falando
diretamente com o hóspede em português brasileiro — tom caloroso e
profissional de hotelaria, respostas curtas (1 a 4 frases), próprias para
WhatsApp/chat (sem markdown, no máximo um emoji).

ESCOPO — você responde SOMENTE com o que estiver em CONTEXTO:
- dados da própria reserva do hóspede (datas, acomodação);
- horários de check-in/check-out e café da manhã;
- Wi-Fi (nome e senha), serviços e informações cadastradas da pousada.

REGRAS:
- Se a informação pedida NÃO estiver no contexto, não invente: diga que vai
  confirmar com a recepção e marque "escalar": true.
- Nunca informe preços, disponibilidade, políticas ou dados de outras
  pessoas/reservas — isso é sempre escalada.
- Pedidos de alteração de reserva, pagamentos, room service, reclamações
  graves ou pedido explícito por atendimento humano → "escalar": true.
- Chame o hóspede pelo primeiro nome quando fizer sentido.

SAÍDA — responda APENAS um JSON válido, sem texto extra:
{"resposta": "<texto ao hóspede>", "escalar": <true|false>, "motivo": "<opcional>"}"""


class ConciergeIn(BaseModel):
    mensagem: str = Field(min_length=1, max_length=1000)
    contexto: dict = {}
    historico: list[dict] = []


@router.post("/concierge")
async def concierge(
    body: ConciergeIn,
    x_internal_key: str | None = Header(default=None),
):
    s = get_settings()
    if not s.openai_api_key:
        raise HTTPException(503, "OPENAI_API_KEY ausente")
    esperado = s.inna_internal_key
    if not esperado or not secrets.compare_digest(
        x_internal_key or "", esperado
    ):
        raise HTTPException(401, "chave interna inválida")

    historico = "\n".join(
        f"{'Hóspede' if m.get('origem') == 'hospede' else 'Maria'}: {m.get('texto', '')}"
        for m in body.historico[-10:]
    )
    prompt = (
        f"CONTEXTO (fatos permitidos):\n{json.dumps(body.contexto, ensure_ascii=False)}\n\n"
        f"HISTÓRICO:\n{historico or '(primeira mensagem)'}\n\n"
        f"MENSAGEM DO HÓSPEDE:\n{body.mensagem}"
    )
    try:
        resp = await _cliente(s).responses.create(
            model=s.openai_llm_model,
            instructions=PROMPT_CONCIERGE,
            input=prompt,
        )
        texto = (getattr(resp, "output_text", "") or "").strip()
    except Exception as exc:
        raise HTTPException(502, f"LLM indisponível: {exc}") from exc
    if not texto:
        raise HTTPException(502, "LLM retornou resposta vazia")
    try:
        saida = json.loads(texto)
        resposta = str(saida.get("resposta", "")).strip()
        if not resposta:
            raise ValueError("resposta vazia")
        return {
            "resposta": resposta,
            "escalar": bool(saida.get("escalar")),
            "motivo": saida.get("motivo"),
        }
    except (ValueError, TypeError):
        # Modelo saiu do formato — o texto vira a resposta e segue sem
        # escalada; pior caso o hóspede recebe uma frase solta, nunca erro.
        return {"resposta": texto, "escalar": False, "motivo": "json_invalido"}
