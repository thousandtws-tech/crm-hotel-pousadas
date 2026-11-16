"""Orquestrador LLM — OpenAI Responses API com function calling.

Mantém o histórico da conversa por sessão (turnos limitados),
executa ferramentas em loop até a resposta final e emite deltas de
texto para síntese incremental.
"""
import asyncio
import json
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from openai import APIError, AsyncOpenAI

from ..config import get_settings
from ..infra import memory
from ..infra.api_client import PousadaApi
from ..infra.auth import Ator
from ..infra.resilience import breaker
from ..telemetry.metrics import Uso
from ..tools import TOOLS, ToolExecutor
from .prompts import SYSTEM_PROMPT

log = logging.getLogger("maria.llm")

OnText = Callable[[str], Awaitable[None]]
OnToolStatus = Callable[[str], Awaitable[None]]

MAX_TOOL_ROUNDS = 6


class _FalhaStream(RuntimeError):
    """Falha do lado do provedor no meio do stream (evento
    `response.failed`/`error`) — conta no circuit breaker."""


@dataclass
class TurnoResult:
    texto: str
    tool_calls: int
    tools: list[dict[str, Any]] = field(default_factory=list)
    usage: dict[str, int] = field(default_factory=dict)


class Orquestrador:
    """Uma instância por sessão — carrega o contexto conversacional."""

    def __init__(self, api: PousadaApi, ator: Ator):
        self.api = api
        self.ator = ator
        self.tools = ToolExecutor(api, ator)
        s = get_settings()
        self._client = AsyncOpenAI(
            api_key=s.openai_api_key,
            timeout=s.openai_timeout_secs,
            max_retries=s.openai_max_retries,
        )
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
        # orçamento por tamanho — turnos longos (respostas com muito
        # dado) não estouram a janela mesmo dentro do limite de turnos
        while (
            len(self._historico) > 2
            and _chars_historico(self._historico) > s.maria_history_max_chars
        ):
            del self._historico[:2]

    async def responder(
        self,
        texto_usuario: str,
        on_text: OnText,
        on_tool: OnToolStatus,
        on_tool_result: Callable[[str, dict[str, Any]], Awaitable[None]] | None = None,
        turno: str = "",
    ) -> TurnoResult:
        """Roda o loop: LLM → ferramentas → LLM → resposta final em stream."""
        self._cancelado = False
        s = get_settings()
        tag = f"[{turno[:8]}] " if turno else ""
        input_msgs = await self._contexto(texto_usuario) + [
            {"role": "user", "content": texto_usuario}
        ]
        saida_total = ""
        chamadas = 0
        tools_log: list[dict[str, Any]] = []
        uso_total = {"input_tokens": 0, "output_tokens": 0}
        kwargs: dict[str, Any] = {}
        if s.openai_llm_reasoning_effort.lower() not in ("", "none"):
            kwargs["reasoning"] = {"effort": s.openai_llm_reasoning_effort}

        modelos = [s.openai_llm_model]
        if s.openai_llm_fallback_model:
            modelos.append(s.openai_llm_fallback_model)

        for _ in range(MAX_TOOL_ROUNDS):
            if self._cancelado:
                break

            # Modelo principal → fallback: a segunda tentativa só roda
            # se nada foi emitido ainda — texto parcial já falado/streamed
            # não pode ser repetido (duplicaria na voz e na tela). Calls
            # coletadas num stream que falhou ainda não executaram —
            # refazer o turno não tem efeito colateral.
            calls: list[dict[str, Any]] = []
            final = None
            # texto emitido na(s) tentativa(s) desta rodada — sobrevive a
            # exceções do stream (deltas já saíram p/ TTS/UI antes da queda)
            emissao = {"texto": ""}
            br = breaker("openai-llm")
            for mi, modelo in enumerate(modelos):
                if self._cancelado:
                    break
                try:
                    # circuito aberto → falha na hora, sem esperar o timeout do SDK
                    with br.vigiar():
                        stream = await self._client.responses.create(
                            model=modelo,
                            input=input_msgs,
                            tools=TOOLS,
                            stream=True,
                            **kwargs,
                        )
                    calls, final, chamadas = await self._consumir(
                        stream, on_text, chamadas, emissao)
                    if mi > 0:
                        log.info("%sresposta veio do modelo fallback %s",
                                 tag, modelo)
                    break
                except (APIError, _FalhaStream) as exc:
                    # falha do provedor no meio do stream conta no breaker;
                    # exceções do callback on_text (TTS/UI) não são da OpenAI
                    br.falha(exc)
                    if emissao["texto"] or mi == len(modelos) - 1:
                        raise
                    log.warning(
                        "%smodelo %s falhou antes de emitir — fallback %s",
                        tag, modelo, modelos[mi + 1])
            saida_total += emissao["texto"]

            if final is not None and getattr(final, "usage", None):
                Uso.tokens(final.usage)
                uso_total["input_tokens"] += int(
                    getattr(final.usage, "input_tokens", 0) or 0)
                uso_total["output_tokens"] += int(
                    getattr(final.usage, "output_tokens", 0) or 0)

            # teto de custo por turno — corta o loop se estourar
            if (uso_total["input_tokens"] + uso_total["output_tokens"]
                    > s.maria_limite_tokens_turno):
                log.warning("%slimite de tokens do turno atingido", tag)
                self._lembra(texto_usuario, saida_total)
                return TurnoResult(
                    texto=saida_total
                    or "Atingi o limite de processamento desse pedido. "
                       "Pode detalhar em partes?",
                    tool_calls=chamadas,
                    tools=tools_log,
                    usage=uso_total,
                )

            if not calls:
                # resposta terminada
                self._lembra(texto_usuario, saida_total)
                return TurnoResult(
                    texto=saida_total,
                    tool_calls=chamadas,
                    tools=tools_log,
                    usage=uso_total,
                )

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

            async def _exec(c: dict[str, Any]) -> dict[str, Any]:
                """Uma tool: parse de args + execução + log (roda em
                paralelo com as demais da mesma rodada)."""
                nome = c["name"]
                try:
                    args = json.loads(c["arguments"] or "{}")
                except json.JSONDecodeError:
                    args = {}
                log.info("%stool %s args=%s", tag, nome, args)
                resultado = await self.tools.run(nome, args)
                Uso.tool(nome, erro=isinstance(resultado, dict)
                         and bool(resultado.get("erro")))
                if isinstance(resultado, dict) and resultado.get("status") == "executada":
                    Uso.inc("acoes_executadas")
                return {"call": c, "nome": nome, "args": args,
                        "resultado": resultado}

            # avisa a UI na ordem emitida, executa em paralelo quando >1
            for c in calls:
                if self._cancelado:
                    break
                await on_tool(c["name"])

            feitos: list[dict[str, Any]] = []
            if self._cancelado:
                pass
            elif s.maria_parallel_tools and len(calls) > 1:
                feitos = await asyncio.gather(*[_exec(c) for c in calls])
            else:
                feitos = [await _exec(c) for c in calls if not self._cancelado]

            for f in feitos:
                if on_tool_result:
                    await on_tool_result(f["nome"], f["resultado"])
                tools_log.append(
                    {"name": f["nome"], "args": f["args"],
                     "ok": not (isinstance(f["resultado"], dict)
                                and f["resultado"].get("erro")),
                     # resultado alimenta o dataset de fine-tune
                     # (transcripts trunca e redige)
                     "result": f["resultado"]}
                )
                input_msgs.append(
                    {
                        "type": "function_call_output",
                        "call_id": f["call"]["call_id"],
                        "output": _saida_para_contexto(
                            f["resultado"], s.maria_tool_result_max_chars),
                    }
                )

        self._lembra(texto_usuario, saida_total)
        return TurnoResult(
            texto=saida_total,
            tool_calls=chamadas,
            tools=tools_log,
            usage=uso_total,
        )

    async def _consumir(
        self,
        stream: Any,
        on_text: OnText,
        chamadas: int,
        emissao: dict[str, str],
    ) -> tuple[list[dict[str, Any]], Any, int]:
        """Consome o stream de uma resposta: devolve (calls, response
        final, total de function_calls). `emissao["texto"]` acumula os
        deltas emitidos — inclusive os anteriores à queda do stream."""
        calls: list[dict[str, Any]] = []
        final = None
        async for ev in stream:
            if self._cancelado:
                break
            t = ev.type
            if t == "response.output_text.delta":
                emissao["texto"] += ev.delta
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
                raise _FalhaStream(f"resposta LLM falhou: {det}")
        return calls, final, chamadas


def _chars_historico(msgs: list[dict[str, Any]]) -> int:
    return sum(len(str(m.get("content", ""))) for m in msgs)


def _saida_para_contexto(resultado: Any, max_chars: int) -> str:
    """Serializa a saída da tool para o contexto, com corte.

    O modelo não precisa de 200 linhas de uma lista para responder por
    voz — o resultado completo segue gravado no diário de turnos.
    """
    out = json.dumps(resultado, ensure_ascii=False)
    if len(out) <= max_chars:
        return out
    return out[:max_chars] + (
        '… [resultado truncado no contexto — resuma o essencial '
        'ou refine a busca com filtros]'
    )


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
