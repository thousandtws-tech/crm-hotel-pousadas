"""Testes do SentenceBuffer — fatiamento do stream do LLM em unidades faláveis.

Semântica real: emite a primeira sentença só quando ela tem ≥ min_len
caracteres, ou quando há backpressure (resto > 120). Sentenças curtas
ficam acumuladas até completar um bloco falável ou o flush final.
"""
from app.pipeline.sentences import SentenceBuffer


def test_sentenca_longa_emitida_imediato():
    b = SentenceBuffer(min_len=24)
    out = b.push("Temos três chegadas hoje na pousada. E mais duas saídas.")
    assert out == ["Temos três chegadas hoje na pousada."]
    assert b.flush() == "E mais duas saídas."


def test_sentencas_curtas_acumulam_ate_flush():
    b = SentenceBuffer(min_len=24)
    assert b.push("Oi. ") == []
    assert b.push("Tudo bem? ") == []
    assert b.flush() == "Oi. Tudo bem?"


def test_backpressure_emite_sentenca_curta():
    b = SentenceBuffer(min_len=24)
    out = b.push("Oi. " + "x" * 130)
    assert out == ["Oi."]


def test_quebra_de_linha_eh_separador():
    b = SentenceBuffer(min_len=5)
    out = b.push("Primeira linha\nSegunda linha")
    assert out == ["Primeira linha"]
    assert b.flush() == "Segunda linha"


def test_flush_vazio_retorna_none():
    assert SentenceBuffer().flush() is None
