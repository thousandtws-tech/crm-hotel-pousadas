"""Testes do pipeline de fine-tuning — formato SFT, dedup, split."""
import json

from app.tools import TOOLS
from finetune import dataset


def _turno(pergunta="quais os check-ins?", resposta="São três.",
           tools=None, **kw):
    return {"ts": "2026-01-01T10:00:00Z", "pergunta": pergunta,
            "resposta": resposta, "tools": tools or [], **kw}


# ------------------------------------------------------------- exemplo --

def test_exemplo_simples_sem_tools():
    ex = dataset.exemplo("oi", "olá!")
    roles = [m["role"] for m in ex["messages"]]
    assert roles == ["system", "user", "assistant"]
    assert "tools" not in ex


def test_exemplo_com_tool_tem_sequencia_completa():
    ex = dataset.exemplo(
        "check-ins de hoje?", "São três.",
        [{"name": "get_checkins", "args": {"data": "hoje"},
          "ok": True, "result": {"total": 3}}])
    roles = [m["role"] for m in ex["messages"]]
    assert roles == ["system", "user", "assistant", "tool", "assistant"]
    call = ex["messages"][2]["tool_calls"][0]
    assert call["function"]["name"] == "get_checkins"
    assert ex["messages"][3]["tool_call_id"] == call["id"]
    assert "tools" in ex
    assert ex["tools"][0]["function"]["name"] == TOOLS[0]["name"]


def test_exemplo_tool_sem_resultado_eh_descartado():
    ex = dataset.exemplo(
        "pergunta", "resposta",
        [{"name": "get_checkins", "args": {}, "ok": True}])  # sem result
    assert ex is None


def test_exemplo_tool_desconhecida_descartada():
    ex = dataset.exemplo(
        "pergunta", "resposta",
        [{"name": "tool_inexistente", "args": {}, "ok": True,
          "result": {}}])
    assert ex is None


def test_exemplo_vazio_rejeitado():
    assert dataset.exemplo("", "oi") is None
    assert dataset.exemplo("oi", "") is None


# ------------------------------------------------------------ turnos --

def test_turno_com_erro_de_tool_excluido():
    t = _turno(tools=[{"name": "get_checkins", "args": {}, "ok": False,
                       "result": {"erro": "api 500"}}])
    assert dataset.turno_para_exemplo(t) is None
    assert dataset.turno_para_exemplo(t, incluir_falhos=True) is not None


def test_curado_usa_resposta_editada():
    reg = _turno(resposta="Resposta revisada pelo humano.")
    ex = dataset.curado_para_exemplo(reg)
    assert ex["messages"][-1]["content"] == "Resposta revisada pelo humano."


# --------------------------------------------------------- construção --

def test_construir_dedup_prioriza_curado():
    turno = _turno(pergunta="Oi", resposta="resposta do log")
    curado = _turno(pergunta="oi", resposta="resposta curada")
    exs, stats = dataset.construir([turno], [curado])
    assert len(exs) == 1
    assert exs[0]["messages"][-1]["content"] == "resposta curada"
    assert stats["duplicados"] == 1


def test_dividir_deterministico():
    exs = [dataset.exemplo(f"pergunta {i}", f"resp {i}") for i in range(30)]
    t1, v1 = dataset.dividir(exs)
    t2, v2 = dataset.dividir(exs)
    assert t1 == t2 and v1 == v2
    assert len(t1) + len(v1) == 30 and len(v1) == 3


def test_dividir_pouco_tudo_treino():
    exs = [dataset.exemplo("p", "r") for _ in range(5)]
    treino, valid = dataset.dividir(exs)
    assert len(treino) == 5 and valid == []


def test_salvar_jsonl(tmp_path):
    exs = [dataset.exemplo("p1", "r1"), dataset.exemplo("p2", "r2")]
    p = tmp_path / "out" / "ft.jsonl"
    assert dataset.salvar_jsonl(exs, p) == 2
    linhas = [json.loads(x) for x in p.read_text(encoding="utf-8").splitlines()]
    assert len(linhas) == 2 and linhas[0]["messages"][1]["content"] == "p1"
