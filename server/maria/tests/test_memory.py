"""Testes da memória persistente — dedup, escopo, relevância, esquecer."""
import pytest

from app.infra import memory
from app.infra.storage import _arquivo_colecao


@pytest.fixture(autouse=True)
def memoria_limpa():
    """Cada teste começa com a coleção de memórias vazia."""
    _arquivo_colecao("memorias").write_text("[]", encoding="utf-8")
    yield


async def test_lembrar_e_listar():
    r = await memory.lembrar("pousada", 1, "O boiler do bloco B esquenta devagar.")
    assert r["ok"] and r["id"]
    itens = await memory.listar(ator_id=999)
    assert any("boiler" in m["texto"] for m in itens)


async def test_dedup_por_texto():
    await memory.lembrar("pousada", 1, "Check-out é ao meio-dia.")
    await memory.lembrar("pousada", 1, "check-out é ao meio-dia.  ")
    itens = await memory.listar(ator_id=1)
    assert len([m for m in itens if "meio-dia" in m["texto"].lower()]) == 1


async def test_escopo_usuario_nao_vaza_para_outro():
    await memory.lembrar("usuario", 1, "Prefiro resumo em 3 linhas.")
    itens_outro = await memory.listar(ator_id=2)
    assert not any("3 linhas" in m["texto"] for m in itens_outro)
    itens_dono = await memory.listar(ator_id=1)
    assert any("3 linhas" in m["texto"] for m in itens_dono)


async def test_escopo_pousada_visivel_a_todos():
    await memory.lembrar("pousada", 1, "Wi-Fi do saguão cai com chuva.")
    for uid in (1, 2, 99):
        itens = await memory.listar(ator_id=uid)
        assert any("Wi-Fi" in m["texto"] for m in itens)


async def test_esquecer():
    r = await memory.lembrar("pousada", 1, "Fato temporário.")
    ok = await memory.esquecer(r["id"])
    assert ok["ok"]
    itens = await memory.listar(ator_id=1)
    assert not any("temporário" in m["texto"] for m in itens)


async def test_relevantes_ranking():
    await memory.lembrar("pousada", 1, "A suíte 12 tem ar-condicionado barulhento.")
    await memory.lembrar("pousada", 1, "O fornecedor de pão entrega às 7h.")
    mems = await memory.relevantes(1, "hóspede reclamou do ar da suíte 12")
    assert mems and "ar-condicionado" in mems[0]


async def test_texto_curto_rejeitado():
    r = await memory.lembrar("pousada", 1, "ok")
    assert not r["ok"]
