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


# ------------------------------------------------------ busca híbrida --

async def test_hibrida_lexical_sem_vetores(base):
    """Sem embeddings (nenhuma chave/vetor), o lado BM25 responde
    sozinho — a base não morre junto com a OpenAI."""
    r = await base.buscar("que horas é o café da manhã?", embedder=None)
    assert r["trechos"]
    fontes = " ".join(t["fonte"] for t in r["trechos"])
    assert "cafe" in fontes or "Horário" in fontes


async def test_hibrida_lexical_captura_termo_exato(tmp_path):
    """Termo exato do domínio (FNRH) ranqueia por BM25 mesmo quando
    o vetor não favorece — é o buraco que o cosseno puro deixava."""
    from app.infra.storage import JsonStore
    d = tmp_path / "kb2"
    d.mkdir()
    (d / "a.md").write_text(
        "# Docs\n\n## FNRH\n\nO registro FNRH é obrigatório para "
        "todo hóspede nacional.\n", encoding="utf-8")
    (d / "b.md").write_text(
        "# Outros\n\n## Estacionamento\n\nVagas na lateral do "
        "prédio, sem reserva.\n", encoding="utf-8")
    b = BaseConhecimento(diretorio=d, store=JsonStore(tmp_path))
    r = await b.buscar("o que é FNRH?", embedder=None)
    assert r["trechos"]
    assert "FNRH" in r["trechos"][0]["fonte"] \
        or "FNRH" in r["trechos"][0]["texto"]


async def test_hibrida_combina_vetor_e_lexico(base, tmp_path):
    """Com embedder falso ativo, os dois sinais fundem por RRF —
    pergunta semântica ainda acha o trecho certo."""
    r = await base.buscar("posso levar meu cachorro?", fake_embedder)
    assert r["trechos"]
    fontes = " ".join(t["fonte"] for t in r["trechos"])
    assert "Pets" in fontes or "politicas" in fontes


async def test_sem_sinal_nenhum_devolve_vazio(base):
    r = await base.buscar("zanzibar quantum flux", embedder=None)
    assert r["trechos"] == []
