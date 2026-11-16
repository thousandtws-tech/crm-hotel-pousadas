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

    async def create(self, model: str, **_: Any):
        self.modelos.append(model)
        t = self._tentativas[len(self.modelos) - 1]
        if isinstance(t, Exception):
            raise t
        return _FakeStream(t)


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
