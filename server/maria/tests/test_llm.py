"""Testes do Orquestrador — contexto, fallback de modelo e helpers.

Roda offline: o cliente OpenAI é substituído por um fake que devolve
streams sintéticos (ou falha) — nada sai do processo.
"""
from __future__ import annotations

import asyncio
import os
from types import SimpleNamespace
from typing import Any

import pytest

# get_settings é lru_cached — a chave precisa existir antes do primeiro
# Orquestrador (AsyncOpenAI exige api_key não-vazia).
os.environ.setdefault("OPENAI_API_KEY", "teste-offline")

from app.agent.llm import (  # noqa: E402
    Orquestrador,
    _chars_historico,
    _FalhaStream,
    _saida_para_contexto,
)
from app.config import get_settings  # noqa: E402

# ---------------------------------------------------------- stream fake --

class _FakeStream:
    def __init__(self, eventos: list[Any]):
        self._eventos = eventos

    def __aiter__(self):
        async def gen():
            for e in self._eventos:
                if isinstance(e, Exception):
                    raise e  # falha no meio do stream
                yield e
        return gen()


class _FakeResponses:
    """Script de tentativas: cada entrada é uma lista de eventos de
    stream ou uma exceção a ser levantada na chamada."""

    def __init__(self, tentativas: list[Any]):
        self._tentativas = tentativas
        self.modelos: list[str] = []

    async def create(self, model: str, **kwargs: Any):
        self.modelos.append(model)
        t = self._tentativas[len(self.modelos) - 1]
        if isinstance(t, Exception):
            raise t
        if kwargs.get("stream"):
            return _FakeStream(t)
        return t  # chamada síncrona (rolling summary, judge…)


class _FakeClient:
    def __init__(self, tentativas: list[Any]):
        self.responses = _FakeResponses(tentativas)


def _ev_delta(txt: str):
    return SimpleNamespace(type="response.output_text.delta", delta=txt)


def _ev_completed(usage=None):
    return SimpleNamespace(
        type="response.completed",
        response=SimpleNamespace(output=[], usage=usage),
    )


async def _vazio(_: str) -> None:
    pass


def _orq(api, ator, tentativas) -> Orquestrador:
    orq = Orquestrador(api, ator)
    orq._client = _FakeClient(tentativas)
    return orq


# ------------------------------------------------------ helpers puros --

def test_saida_para_contexto_nao_trunca_resultado_curto():
    out = _saida_para_contexto({"ok": True}, 6000)
    assert '"ok": true' in out


def test_saida_para_contexto_trunca_resultado_longo():
    grande = {"items": [{"id": i, "nome": "x" * 100} for i in range(200)]}
    out = _saida_para_contexto(grande, 1000)
    assert len(out) < 1200
    assert "truncado" in out


def test_chars_historico_soma_conteudo():
    msgs = [{"content": "abc"}, {"content": "de"}]
    assert _chars_historico(msgs) == 5


# -------------------------------------------------- orçamento histórico --

def test_historico_corta_por_tamanho(api, admin):
    s = get_settings()
    antigo = s.maria_history_max_chars
    s.maria_history_max_chars = 100
    try:
        orq = Orquestrador(api, admin)
        orq._client = _FakeClient([])
        for i in range(10):
            orq._lembra(f"pergunta {i} " + "x" * 40, f"resposta {i} " + "y" * 40)
        # cada par (~100 chars) > orçamento — só o mais recente sobrevive
        assert len(orq._historico) == 2
        # sempre corta em pares — user/assistant nunca ficam órfãos
        assert len(orq._historico) % 2 == 0
        assert orq._historico[0]["role"] == "user"
    finally:
        s.maria_history_max_chars = antigo


# ------------------------------------------------------------ fallback --

def test_fallback_quando_principal_falha_sem_emitir(api, admin):
    s = get_settings()
    antigo = s.openai_llm_fallback_model
    s.openai_llm_fallback_model = "modelo-reserva"
    try:
        orq = _orq(api, admin, [
            _FalhaStream("primário caiu"),
            [_ev_delta("Olá! "), _ev_delta("tudo bem?"), _ev_completed()],
        ])
        saida = asyncio.run(orq.responder("oi", _vazio, _vazio))
        assert "tudo bem" in saida.texto
        assert orq._client.responses.modelos == [
            s.openai_llm_model, "modelo-reserva"]
    finally:
        s.openai_llm_fallback_model = antigo


def test_sem_fallback_erro_propaga(api, admin):
    s = get_settings()
    antigo = s.openai_llm_fallback_model
    s.openai_llm_fallback_model = ""
    try:
        orq = _orq(api, admin, [_FalhaStream("primário caiu")])
        with pytest.raises(_FalhaStream):
            asyncio.run(orq.responder("oi", _vazio, _vazio))
    finally:
        s.openai_llm_fallback_model = antigo


def test_fallback_nao_repete_texto_parcial(api, admin):
    """Se o primário emitiu texto antes de cair, não refaz — os deltas já
    foram falados/streamed e repetir duplicaria a resposta."""
    s = get_settings()
    antigo = s.openai_llm_fallback_model
    s.openai_llm_fallback_model = "modelo-reserva"
    emitidos: list[str] = []

    async def coleta(d: str) -> None:
        emitidos.append(d)

    try:
        orq = _orq(api, admin, [
            [_ev_delta("Metade da resposta"), _FalhaStream("caiu no meio")],
            [_ev_delta("Resposta do fallback"), _ev_completed()],
        ])
        with pytest.raises(_FalhaStream):
            asyncio.run(orq.responder("oi", coleta, _vazio))
        # tentou só o primário — nada do fallback
        assert orq._client.responses.modelos == [s.openai_llm_model]
    finally:
        s.openai_llm_fallback_model = antigo


def test_historico_desligado_nao_acumula(api, admin):
    s = get_settings()
    antigo = s.maria_history_enabled
    s.maria_history_enabled = False
    try:
        orq = Orquestrador(api, admin)
        orq._lembra("p", "r")
        assert orq._historico == []
    finally:
        s.maria_history_enabled = antigo


# ----------------------------------------------------- rolling summary --

def test_pares_descartados_viram_material(api, admin):
    s = get_settings()
    antigo = s.maria_history_max_turns
    s.maria_history_max_turns = 1
    try:
        orq = Orquestrador(api, admin)
        orq._client = _FakeClient([])
        orq._lembra("reserva do joão?", "a 12, suíte 4")
        orq._lembra("e o check-in?", "feito às 14h")
        assert orq._para_resumir == ["U: reserva do joão?", "A: a 12, suíte 4"]
    finally:
        s.maria_history_max_turns = antigo


def test_resumo_entra_no_contexto(api, admin):
    s = get_settings()
    ant_turnos = s.maria_history_max_turns
    ant_sum = s.maria_summary_enabled
    s.maria_history_max_turns = 1
    s.maria_summary_enabled = True
    try:
        orq = _orq(api, admin, [
            SimpleNamespace(output_text="João tinha reserva 12 na suíte 4."),
        ])
        orq._lembra("reserva do joão?", "a 12, suíte 4")
        orq._lembra("e o check-in?", "feito às 14h")
        msgs = asyncio.run(orq._contexto("e o checkout dele?"))
        resumos = [m["content"] for m in msgs if m["role"] == "developer"
                   and "Resumo da conversa" in m["content"]]
        assert resumos and "suíte 4" in resumos[0]
        assert orq._resumo == "João tinha reserva 12 na suíte 4."
        assert orq._para_resumir == []
    finally:
        s.maria_history_max_turns = ant_turnos
        s.maria_summary_enabled = ant_sum


def test_summary_desligada_descarta_sem_chamar(api, admin):
    s = get_settings()
    ant_turnos = s.maria_history_max_turns
    ant_sum = s.maria_summary_enabled
    s.maria_history_max_turns = 1
    s.maria_summary_enabled = False
    try:
        orq = _orq(api, admin, [])
        orq._lembra("p1", "r1")
        orq._lembra("p2", "r2")
        msgs = asyncio.run(orq._contexto("p3"))
        assert orq._para_resumir == []
        assert orq._resumo is None
        assert all("Resumo da conversa" not in str(m) for m in msgs)
    finally:
        s.maria_history_max_turns = ant_turnos
        s.maria_summary_enabled = ant_sum


# ------------------------------------------- fallback chat (Cerebras) --

class _FakeChatCompletions:
    def __init__(self, tentativas):
        self._tentativas = tentativas
        self.modelos: list[str] = []
        self.last_kwargs: dict = {}

    async def create(self, model: str, **kwargs: Any):
        self.modelos.append(model)
        self.last_kwargs = kwargs
        t = self._tentativas[len(self.modelos) - 1]
        if isinstance(t, Exception):
            raise t
        return _FakeStream(t)


class _FakeChatClient:
    def __init__(self, tentativas):
        self.chat = SimpleNamespace(
            completions=_FakeChatCompletions(tentativas))


def _ev_chat(txt: str):
    return SimpleNamespace(
        choices=[SimpleNamespace(delta=SimpleNamespace(content=txt))],
        usage=None)


def _ev_chat_usage(in_t=10, out_t=5):
    return SimpleNamespace(
        choices=[],
        usage=SimpleNamespace(prompt_tokens=in_t, completion_tokens=out_t))


def _ev_chat_toolcall(nome="get_checkins", args="{}"):
    tc = SimpleNamespace(
        index=0, id="call_abc",
        function=SimpleNamespace(name=nome, arguments=args))
    return SimpleNamespace(
        choices=[SimpleNamespace(delta=SimpleNamespace(
            content=None, tool_calls=[tc]))],
        usage=None)


def test_fallback_cerebras_responde_quando_openai_cai(api, admin):
    s = get_settings()
    antigos = (s.cerebras_api_key, s.cerebras_model)
    s.cerebras_api_key = "csk-teste"
    s.cerebras_model = "llama-3.3-70b"
    try:
        orq = _orq(api, admin, [_FalhaStream("openai caiu")])
        orq._fb = _FakeChatClient([
            [_ev_chat("Opa! "), _ev_chat("temos dois check-ins hoje."),
             _ev_chat_usage()],
        ])
        saida = asyncio.run(orq.responder("check-ins de hoje?", _vazio, _vazio))
        assert "dois check-ins" in saida.texto
        assert orq._fb.chat.completions.modelos == ["llama-3.3-70b"]
        assert saida.usage["input_tokens"] == 10
        # tools no formato chat (function wrapper)
        tool0 = orq._fb.chat.completions.last_kwargs["tools"][0]
        assert tool0["type"] == "function" and "function" in tool0
    finally:
        s.cerebras_api_key, s.cerebras_model = antigos


def test_fallback_cerebras_tool_call_fragmentada(api, admin):
    """tool_calls do chat chegam por index — acumula e executa."""
    s = get_settings()
    antigos = (s.cerebras_api_key, s.cerebras_model)
    s.cerebras_api_key = "csk-teste"
    s.cerebras_model = "llama-test"
    try:
        orq = _orq(api, admin, [_FalhaStream("openai caiu"),
                            _FalhaStream("openai caiu de novo")])
        orq._fb = _FakeChatClient([
            [_ev_chat_toolcall(), _ev_chat_usage()],  # rodada 1: call
            [_ev_chat("São dois hóspedes hoje."), _ev_chat_usage()],
        ])
        orq.api.rotas = {
            ("get", "/reservas"): {"items": [{"id": 1}], "total": 1}}
        nomes = []
        async def on_tool(n): nomes.append(n)
        saida = asyncio.run(
            orq.responder("check-ins?", _vazio, on_tool))
        assert "get_checkins" in nomes
        assert "dois hóspedes" in saida.texto
        assert saida.tool_calls == 1
    finally:
        s.cerebras_api_key, s.cerebras_model = antigos


def test_msgs_chat_traduz_formato_responses():
    from app.agent.llm import _msgs_chat
    msgs = [
        {"role": "developer", "content": "regras"},
        {"role": "user", "content": "oi"},
        {"role": "assistant",
         "content": [{"type": "output_text", "text": "olá"}]},
        {"type": "function_call", "call_id": "c1",
         "name": "get_x", "arguments": "{}"},
        {"type": "function_call_output", "call_id": "c1",
         "output": '{"ok":1}'},
    ]
    out = _msgs_chat(msgs)
    assert out[0] == {"role": "system", "content": "regras"}
    assert out[2] == {"role": "assistant", "content": "olá"}
    assert out[3]["tool_calls"][0]["function"]["name"] == "get_x"
    assert out[4]["role"] == "tool" and out[4]["tool_call_id"] == "c1"
