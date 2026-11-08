"""Testes do store — contrato dos backends JSON/SQLite e migração."""
import json

from app.infra.storage import JsonStore, SqliteStore, _arquivo_colecao
from app.telemetry import metrics

# ------------------------------------------------- contrato comum --

async def _contrato(store):
    await store.append("coisas", {"id": "a", "n": 1})
    await store.append("coisas", {"id": "b", "n": 2})
    docs = await store.todos("coisas")
    assert [d["id"] for d in docs] == ["a", "b"]

    await store.salvar_todos("coisas", [{"id": "c", "n": 3}])
    assert [d["id"] for d in await store.todos("coisas")] == ["c"]

    assert await store.remover("coisas", "id", "c") == 1
    assert await store.remover("coisas", "id", "c") == 0
    assert await store.todos("coisas") == []

    await store.kv_set("teste", {"x": [1, 2, 3]})
    assert await store.kv_get("teste") == {"x": [1, 2, 3]}
    assert await store.kv_get("inexistente") is None


async def test_json_store(tmp_path):
    await _contrato(JsonStore(tmp_path))


async def test_sqlite_store(tmp_path):
    st = SqliteStore(tmp_path / "m.db")
    await _contrato(st)
    await st.fechar()


async def test_json_store_turnos_append_jsonl(tmp_path):
    """Coleção 'turnos' continua JSONL com append por linha."""
    p = _arquivo_colecao("turnos")  # via settings (env do conftest)
    p.unlink(missing_ok=True)
    st = JsonStore(tmp_path)
    for i in range(3):
        await st.append("turnos", {"pergunta": f"p{i}"})
    linhas = p.read_text(encoding="utf-8").strip().splitlines()
    assert len(linhas) == 3
    docs = await st.todos("turnos")
    assert docs[2]["pergunta"] == "p2"


# ------------------------------------------------------- migração --

async def test_sqlite_migra_json_legado(tmp_path):
    """Primeira abertura do SqliteStore importa os JSONs existentes."""
    p_mem = _arquivo_colecao("memorias")
    p_turn = _arquivo_colecao("turnos")
    p_mem.write_text(json.dumps(
        [{"id": "m1", "escopo": "pousada", "texto": "legado"}]),
        encoding="utf-8")
    p_turn.write_text('{"pergunta": "velha"}\n', encoding="utf-8")

    st = SqliteStore(tmp_path / "mig.db")
    mems = await st.todos("memorias")
    turnos = await st.todos("turnos")
    assert any(m["texto"] == "legado" for m in mems)
    assert any(t["pergunta"] == "velha" for t in turnos)

    # não duplica na segunda abertura
    st2 = SqliteStore(tmp_path / "mig.db")
    assert len([m for m in await st2.todos("memorias")
                if m["texto"] == "legado"]) == 1
    await st.fechar()
    await st2.fechar()


# ------------------------------------------------------- métricas --

def test_uso_snapshot_restaurar():
    snap = {"turnos": 5, "tokens_input": 1000,
            "por_ferramenta": {"get_reservas": 3}}
    metrics.Uso.restaurar(snap)
    resumo = metrics.Uso.resumo()
    assert resumo["turnos"] >= 5
    assert resumo["top_ferramentas"].get("get_reservas", 0) >= 3


def test_latencia_snapshot_restaurar():
    metrics.Latencia.restaurar({"stt_final": [0.5, 0.7, 0.9]})
    resumo = metrics.Latencia.resumo()
    assert resumo["stt_final"]["n"] >= 3


def test_prometheus_formato():
    out = metrics.prometheus()
    assert "# HELP maria_turnos_total" in out
    assert "maria_tokens_input_total" in out
    assert 'maria_latencia_segundos{estagio="stt_final"' in out


async def test_persistir_e_restaurar_metricas(tmp_path):
    st = JsonStore(tmp_path)
    metrics.Uso.inc("turnos", 7)
    await metrics.persistir_metricas(st)
    salvo = await st.kv_get("metricas")
    assert salvo["uso"]["turnos"] >= 7
    await metrics.restaurar_metricas(st)  # não levanta exceção
