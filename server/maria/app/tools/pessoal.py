"""Memória aprendida e base de conhecimento (RAG).

Parte do pacote app.tools — ver __init__.py.
"""
from typing import Any

from ..config import get_settings
from ..infra import knowledge, memory
from .helpers import _props

SCHEMAS: list[dict[str, Any]] = [
    {
        "type": "function",
        "name": "salvar_memoria",
        "description": (
            "Memoriza um fato durável que o usuário ensinou ou corrigiu "
            "(preferência, rotina da casa, informação operacional estável). "
            "escopo='pousada' vale para todos; 'usuario' só para quem falou. "
            "Não memorize dados sensíveis nem o que já está no sistema."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                escopo={"type": "string", "enum": ["usuario", "pousada"]},
                texto={"type": "string", "description": "Fato a memorizar, em uma frase"},
            ),
            "required": ["escopo", "texto"],
        },
    },
    {
        "type": "function",
        "name": "esquecer_memoria",
        "description": "Apaga uma memória pelo id (quando o usuário pede para esquecer).",
        "parameters": {
            "type": "object",
            "properties": _props(
                id={"type": "string", "description": "ID da memória"},
            ),
            "required": ["id"],
        },
    },
    {
        "type": "function",
        "name": "listar_memorias",
        "description": "Lista o que a Maria memorizou (pousada + deste usuário).",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "type": "function",
        "name": "buscar_conhecimento",
        "description": (
            "Consulta a base de conhecimento da pousada: políticas, "
            "horários, regras da casa, wi-fi, procedimentos e respostas "
            "de 'como funciona / como faço'. NÃO traz dados operacionais "
            "ao vivo (reservas, estoque, caixa) — esses vêm das demais "
            "ferramentas. Retorna trechos com a fonte."
        ),
        "parameters": {
            "type": "object",
            "properties": _props(
                pergunta={
                    "type": "string",
                    "description": "Pergunta ou assunto a pesquisar na base",
                },
            ),
            "required": ["pergunta"],
        },
    },
]


async def handle(ex, nome: str, a: dict[str, Any]) -> dict[str, Any]:
    """Despacha as tools deste domínio. `ex` é o ToolExecutor
    (api, ator, tz, _exec, _preparar_*).
    """
    match nome:
        case "salvar_memoria":
            if not get_settings().maria_memory_enabled:
                return {"erro": "memória desabilitada"}
            return await memory.lembrar(
                a.get("escopo", "usuario"),
                ex.ator.idfuncionario,
                a.get("texto", ""),
            )

        case "esquecer_memoria":
            return await memory.esquecer(str(a.get("id", "")))

        case "listar_memorias":
            return {"memorias": await memory.listar(ex.ator.idfuncionario)}

        case "buscar_conhecimento":
            return await knowledge.buscar(
                a.get("pergunta", ""), embedder=ex._embedder)

        case _:
            return {"erro": "desconhecida", "mensagem": f"Ferramenta '{nome}' não existe."}
