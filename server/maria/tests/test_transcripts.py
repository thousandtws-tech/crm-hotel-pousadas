"""Testes do diário de turnos — escrita JSONL, leitura e redação."""
import pytest

from app.infra import transcripts


@pytest.fixture(autouse=True)
def arquivo_limpo():
    p = transcripts._arquivo()
    if p.exists():
        p.unlink()
    yield


async def test_registrar_e_ler():
    await transcripts.registrar(
        idfuncionario=1, origem="texto",
        pergunta="quais os check-ins de hoje?",
        resposta="São três chegadas.",
        tools=[{"name": "get_checkins", "args": {"data": "hoje"}, "ok": True}],
        latencias={"llm_primeiro_token": 0.8},
        usage={"input_tokens": 500, "output_tokens": 30},
    )
    turnos = transcripts.ler()
    assert len(turnos) == 1
    t = turnos[0]
    assert t["pergunta"].startswith("quais")
    assert t["tools"][0]["name"] == "get_checkins"
    assert t["usage"]["input_tokens"] == 500


async def test_redacao_de_campos_sensiveis():
    await transcripts.registrar(
        idfuncionario=1, origem="texto",
        pergunta="cadastra o funcionário",
        resposta="ok",
        tools=[{"name": "preparar_funcionario",
                "args": {"nome": "Ana", "senha": "segredo123", "cpf": "111"},
                "ok": True}],
        latencias={},
    )
    t = transcripts.ler()[0]
    assert t["tools"][0]["args"]["senha"] == "***"
    assert t["tools"][0]["args"]["cpf"] == "***"
    assert t["tools"][0]["args"]["nome"] == "Ana"


async def test_resultado_da_tool_truncado_e_redigido():
    grande = {"cpf": "123", "dados": "x" * 5000}
    await transcripts.registrar(
        idfuncionario=1, origem="texto", pergunta="p", resposta="r",
        tools=[{"name": "get_clientes", "args": {},
                "ok": True, "result": grande}],
        latencias={})
    t = transcripts.ler()[0]
    res = t["tools"][0]["result"]
    assert isinstance(res, str) and len(res) <= 1500
    assert "***" in res  # cpf redigido antes de serializar


async def test_estatisticas():
    for _ in range(3):
        await transcripts.registrar(
            idfuncionario=1, origem="voz", pergunta="x", resposta="y",
            tools=[{"name": "get_reservas", "args": {}, "ok": True}],
            latencias={})
    stats = transcripts.estatisticas()
    assert stats["turnos"] == 3
    assert stats["top_tools"]["get_reservas"] == 3
