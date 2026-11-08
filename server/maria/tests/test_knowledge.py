"""Testes do RAG — fatiamento, cosseno e busca com embedder falso.

O embedder fake é determinístico: bag-of-bigramas de caracteres —
similaridade real por sobreposição de texto, sem OpenAI.
"""
import pytest

from app.infra.knowledge import BaseConhecimento, _cos, fatiar
from app.infra.storage import JsonStore

# ----------------------------------------------------------- embedder --

def _bigramas(s: str) -> dict[str, int]:
    s = s.lower()
    return {s[i:i + 2]: 1 for i in range(len(s) - 1)}


async def fake_embedder(textos: list[str]) -> list[list[float]]:
    """Vetor de 512 dimensões derivado de bigramas — determinístico."""
    out = []
    for t in textos:
        v = [0.0] * 512
        for bg in _bigramas(t):
            v[hash(bg) % 512] += 1.0
        out.append(v)
    return out


@pytest.fixture
def base(tmp_path):
    d = tmp_path / "kb"
    d.mkdir()
    (d / "politicas.md").write_text(
        "# Políticas\n\n"
        "## Check-in e check-out\n\n"
        "O check-in é a partir das 14h e o check-out até o meio-dia.\n\n"
        "## Pets\n\nAceitamos cães de pequeno porte mediante taxa.\n",
        encoding="utf-8")
    (d / "cafe.md").write_text(
        "# Café\n\n## Horário\n\n"
        "O café da manhã é servido das 7h30 às 10h na varanda.\n",
        encoding="utf-8")
    return BaseConhecimento(diretorio=d, store=JsonStore(tmp_path))


# ----------------------------------------------------------- fatiar --

def test_fatiar_por_titulos():
    doc = "# T\n\n## Sec A\n\ntexto A\n\n## Sec B\n\ntexto B\n"
    trechos = fatiar(doc, "a.md")
    fontes = [t.fonte for t in trechos]
    assert any("Sec A" in f for f in fontes)
    assert any("Sec B" in f for f in fontes)
    assert any(t.texto == "texto A" for t in trechos)


def test_fatiar_sem_titulo():
    trechos = fatiar("só texto corrido curto", "x.md")
    assert len(trechos) == 1 and trechos[0].fonte == "x.md"


def test_fatiar_vazio():
    assert fatiar("", "x.md") == []


def test_cosseno():
    assert _cos([1, 0], [1, 0]) == 1.0
    assert _cos([1, 0], [0, 1]) == 0.0
    assert _cos([], [1]) == 0.0


# ------------------------------------------------------------- busca --

async def test_busca_retorna_trecho_relevante(base):
    r = await base.buscar("qual o horário do check-out?", fake_embedder)
    assert r["trechos"]
    fontes = " ".join(t["fonte"] for t in r["trechos"])
    assert "Check-in" in fontes or "politicas" in fontes


async def test_busca_cafe(base):
    r = await base.buscar("horário do café da manhã", fake_embedder)
    textos = " ".join(t["texto"] for t in r["trechos"])
    assert "7h30" in textos


async def test_base_vazia(tmp_path):
    d = tmp_path / "vazio"
    d.mkdir()
    b = BaseConhecimento(diretorio=d, store=JsonStore(tmp_path))
    r = await b.buscar("qualquer coisa", fake_embedder)
    assert r["trechos"] == [] and "vazia" in r["mensagem"]


async def test_reindex_so_o_que_mudou(base, tmp_path):
    chamadas = []

    async def contando(textos):
        chamadas.append(len(textos))
        return await fake_embedder(textos)

    await base.buscar("check-out", contando)
    primeira = chamadas[-1]
    assert primeira > 0

    # segunda busca sem mudança → nenhum embed novo de doc
    await base.buscar("check-out de novo", contando)
    assert chamadas[-1] == 1  # só a pergunta
