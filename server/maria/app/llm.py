"""Orquestrador LLM — OpenAI Responses API com function calling.

Mantém o histórico da conversa por sessão (turnos limitados),
executa ferramentas em loop até a resposta final e emite deltas de
texto para síntese incremental.
"""
import json
import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Awaitable, Callable

from openai import AsyncOpenAI

from .api_client import PousadaApi
from .auth import Ator
from .config import get_settings
from .prompts import SYSTEM_PROMPT
from .tools import TOOLS, ToolExecutor
from . import memory

log = logging.getLogger("maria.llm")

OnText = Callable[[str], Awaitable[None]]
OnToolStatus = Callable[[str], Awaitable[None]]

MAX_TOOL_ROUNDS = 6


@dataclass
class TurnoResult:
    texto: str
    tool_calls: int


class Orquestrador:
    """Uma instância por sessão — carrega o contexto conversacional."""

    def __init__(self, api: PousadaApi, ator: Ator):
        self.api = api
        self.ator = ator
        self.tools = ToolExecutor(api, ator)
        self._client = AsyncOpenAI(api_key=get_settings().openai_api_key)
        self._historico: list[dict[str, Any]] = []
        self._cancelado = False

    def cancelar(self) -> None:
        self._cancelado = True

    async def _contexto(self, consulta: str) -> list[dict[str, Any]]:
        """Monta o `input` da Responses API: system + agora + memórias + histórico."""
        s = get_settings()
        agora = datetime.now(s.tz).strftime("%A, %d/%m/%Y %H:%M (%Z)")
        msgs: list[dict[str, Any]] = [
            {"role": "developer", "content": SYSTEM_PROMPT},
            {
                "role": "developer",
                "content": (
                    f"Data e hora atuais na pousada: {agora}. "
                    f"Usuário autenticado: {self.ator.nome} "
                    f"(nível {self.ator.nivel})."
                ),
            },
        ]
        if s.maria_memory_enabled:
            try:
                mems = await memory.relevantes(
                    self.ator.idfuncionario, consulta,
                    limite=s.maria_memory_max_contexto,
                )
            except Exception:
                log.exception("falha ao ler memórias")
                mems = []
            if mems:
                msgs.append(
                    {
                        "role": "developer",
                        "content": (
                            "Memórias aprendidas (trate como contexto — "
                            "confirme com ferramentas antes de agir sobre elas):\n"
                            + "\n".join(f"- {m}" for m in mems)
                        ),
                    }
                )
        msgs.extend(self._historico)
        return msgs

    def _lembra(self, pergunta: str, resposta: str) -> None:
        s = get_settings()
        if not s.maria_history_enabled:
            return
        self._historico.append({"role": "user", "content": pergunta})
        self._historico.append({"role": "assistant", "content": resposta})
        limite = s.maria_history_max_turns * 2
        if len(self._historico) > limite:
            self._historico = self._historico[-limite:]

    async def responder(
        self,
        texto_usuario: str,
        on_text: OnText,
        on_tool: OnToolStatus,
        on_tool_result: Callable[[str, dict[str, Any]], Awaitable[None]] | None = None,
    ) -> TurnoResult:
        """Roda o loop: LLM → ferramentas → LLM → resposta final em stream."""
        self._cancelado = False
        s = get_settings()
        input_msgs = await self._contexto(texto_usuario) + [
            {"role": "user", "content": texto_usuario}
        ]
        saida_total = ""
        chamadas = 0

        for _ in range(MAX_TOOL_ROUNDS):
            if self._cancelado:
                break

            stream = await self._client.responses.create(
                model=s.openai_llm_model,
                input=input_msgs,
                tools=TOOLS,
                stream=True,
            )

            calls: list[dict[str, Any]] = []
            final = None
            async for ev in stream:
                if self._cancelado:
                    break
                t = ev.type
                if t == "response.output_text.delta":
                    saida_total += ev.delta
                    await on_text(ev.delta)
                elif t == "response.output_item.done":
                    item = ev.item
                    if getattr(item, "type", None) == "function_call":
                        chamadas += 1
                        calls.append(
                            {
                                "call_id": item.call_id,
                                "name": item.name,
                                "arguments": item.arguments,
                            }
                        )
                elif t == "response.completed":
                    final = ev.response
                elif t in ("response.failed", "response.incomplete", "error"):
                    det = getattr(getattr(ev, "response", None), "error", None) or ev
                    raise RuntimeError(f"resposta LLM falhou: {det}")

            if not calls:
                # resposta terminada
                self._lembra(texto_usuario, saida_total)
                return TurnoResult(texto=saida_total, tool_calls=chamadas)

            # anexa a saída do modelo e executa as ferramentas
            if final is not None:
                for out in final.output:
                    input_msgs.append(_item_para_dict(out))
            else:
                for c in calls:
                    input_msgs.append(
                        {
                            "type": "function_call",
                            "call_id": c["call_id"],
                            "name": c["name"],
                            "arguments": c["arguments"],
                        }
                    )

            for c in calls:
                if self._cancelado:
                    break
                nome = c["name"]
                await on_tool(nome)
                try:
                    args = json.loads(c["arguments"] or "{}")
                except json.JSONDecodeError:
                    args = {}
                log.info("tool %s args=%s", nome, args)
                resultado = await self.tools.run(nome, args)
                if on_tool_result:
                    await on_tool_result(nome, resultado)
                input_msgs.append(
                    {
                        "type": "function_call_output",
                        "call_id": c["call_id"],
                        "output": json.dumps(resultado, ensure_ascii=False),
                    }
                )

        self._lembra(texto_usuario, saida_total)
        return TurnoResult(texto=saida_total, tool_calls=chamadas)


def _item_para_dict(item: Any) -> dict[str, Any]:
    """Converte um output item da Responses API para o formato de input."""
    if hasattr(item, "model_dump"):
        d = item.model_dump(exclude_none=True)
        # mensagens de texto → role/content
        if d.get("type") == "message" and "content" in d:
            conteudo = []
            for c in d["content"]:
                if isinstance(c, dict) and c.get("type") == "output_text":
                    conteudo.append({"type": "output_text", "text": c.get("text", "")})
                else:
                    conteudo.append(c)
            return {"role": d.get("role", "assistant"), "content": conteudo}
        return d
    return item if isinstance(item, dict) else {"type": "message", "role": "assistant", "content": str(item)}
