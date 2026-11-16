"""Testes do servidor MCP — protocolo JSON-RPC stateless em /mcp.

Autenticação e API do sistema são stubadas: validar_token devolve um
Ator fixo e PousadaApi é a FakeApi — nada sai do processo.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import app.mcp as mcp_mod
from app.infra.auth import Ator
from app.main import app
from tests.conftest import FakeApi

ADMIN = Ator(idfuncionario=1, login="admin", nome="Admin", nivel=1)
H = {"Authorization": "Bearer token-ok"}


@pytest.fixture
def client(monkeypatch):
    async def _validar(_: str) -> Ator:
        return ADMIN

    monkeypatch.setattr(mcp_mod, "validar_token", _validar)
    monkeypatch.setattr(
        mcp_mod, "PousadaApi",
        lambda _token: FakeApi(rotas={
            ("get", "/reservas"): {"items": [{"id": 1}], "total": 1},
        }))
    mcp_mod._PENDENTES.clear()
    return TestClient(app)


def rpc(metodo: str, params: dict | None = None, rid: int = 1) -> dict:
    return {"jsonrpc": "2.0", "id": rid, "method": metodo,
            "params": params or {}}


# ---------------------------------------------------------------- auth --

def test_sem_token_401(client):
    r = client.post("/mcp", json=rpc("tools/list"))
    assert r.status_code == 401


# ----------------------------------------------------------- protocolo --

def test_initialize(client):
    r = client.post("/mcp", json=rpc("initialize"), headers=H)
    res = r.json()["result"]
    assert res["protocolVersion"]
    assert res["serverInfo"]["name"] == "maria-mcp"
    assert "tools" in res["capabilities"]


def test_tools_list_expoe_todas(client):
    r = client.post("/mcp", json=rpc("tools/list"), headers=H)
    tools = r.json()["result"]["tools"]
    assert len(tools) > 100
    t = tools[0]
    assert t["name"] and t["description"]
    assert t["inputSchema"]["type"] == "object"


def test_tools_call_leitura(client):
    r = client.post("/mcp", headers=H, json=rpc("tools/call", {
        "name": "get_checkins", "arguments": {},
    }))
    res = r.json()["result"]
    assert "content" in res
    assert res["content"][0]["type"] == "text"
    assert not res.get("isError")


def test_tools_call_desconhecida_da_erro(client):
    r = client.post("/mcp", headers=H, json=rpc("tools/call", {
        "name": "nao_existe", "arguments": {},
    }))
    res = r.json()["result"]
    assert res.get("isError")


def test_preparar_confirmar_entre_requests(client):
    """O fluxo de escrita funciona stateless: a pendência vive entre
    requests do mesmo usuário."""
    r = client.post("/mcp", headers=H, json=rpc("tools/call", {
        "name": "preparar_cancelamento",
        "arguments": {"idreserva": 7, "motivo": "hóspede ligou"},
    }))
    import json as _json
    resultado = _json.loads(r.json()["result"]["content"][0]["text"])
    assert resultado.get("status") == "preparada"
    idacao = resultado["idacao"]

    r2 = client.post("/mcp", headers=H, json=rpc("tools/call", {
        "name": "confirmar_acao", "arguments": {"idacao": idacao},
    }))
    conf = _json.loads(r2.json()["result"]["content"][0]["text"])
    assert conf.get("status") == "executada"


def test_confirmar_acao_expirada(client):
    r = client.post("/mcp", headers=H, json=rpc("tools/call", {
        "name": "confirmar_acao", "arguments": {"idacao": "ac-xyz"},
    }))
    import json as _json
    conf = _json.loads(r.json()["result"]["content"][0]["text"])
    assert conf.get("erro") == "acao_expirada"


def test_notificacao_sem_resposta(client):
    r = client.post("/mcp", headers=H,
                    json=rpc("notifications/initialized"))
    assert r.status_code == 202


def test_metodo_desconhecido(client):
    r = client.post("/mcp", headers=H, json=rpc("resources/list"))
    assert r.json()["error"]["code"] == -32601


def test_get_mcp_405(client):
    r = client.get("/mcp")
    assert r.status_code == 405
