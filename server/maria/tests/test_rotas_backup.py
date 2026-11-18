"""Rotas /backup — auth admin, gates e gatilho manual."""
import pytest
from httpx import ASGITransport, AsyncClient

from app import main
from app.config import get_settings
from app.infra import pg_backup


@pytest.fixture
async def client():
    transport = ASGITransport(app=main.app)
    async with AsyncClient(transport=transport,
                           base_url="http://t") as c:
        yield c


@pytest.fixture
def auth_admin(monkeypatch, admin):
    async def _v(_t):
        return admin
    monkeypatch.setattr("app.rotas_backup.validar_token", _v)


@pytest.fixture
def auth_recep(monkeypatch, recepcao):
    async def _v(_t):
        return recepcao
    monkeypatch.setattr("app.rotas_backup.validar_token", _v)


async def test_status_sem_token_401(client):
    r = await client.get("/backup/status")
    assert r.status_code == 401


async def test_status_recepcao_403(client, auth_recep):
    r = await client.get("/backup/status",
                         headers={"Authorization": "Bearer x"})
    assert r.status_code == 403


async def test_status_admin_mostra_gates(client, auth_admin, monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "backup_database_url", "postgres://x")
    monkeypatch.setattr(s, "maria_s3_bucket", "bkt")
    monkeypatch.setattr(s, "maria_s3_endpoint", "http://minio:9000")
    monkeypatch.setattr(s, "maria_backup_enabled", False)
    r = await client.get("/backup/status",
                         headers={"Authorization": "Bearer x"})
    assert r.status_code == 200
    body = r.json()
    assert body["pg"]["habilitado"] is True
    assert body["dados"]["habilitado"] is False
    assert body["s3"]["endpoint"] == "http://minio:9000"
    assert body["s3"]["bucket"] == "bkt"
    assert "key" not in str(body).lower()   # nunca vaza credencial


async def test_pg_manual_dispara_e_retorna_stats(client, auth_admin,
                                                 monkeypatch):
    chamou = []

    async def _fake(**_kw):
        chamou.append(1)
        return {"ok": True, "chave": "backups/pg/x.dump.gz",
                "bytes": 10, "podados": 0}
    monkeypatch.setattr(pg_backup, "backup_pg_agora", _fake)
    r = await client.post("/backup/pg",
                          headers={"Authorization": "Bearer x"})
    assert r.status_code == 200
    assert r.json()["chave"].endswith(".dump.gz")
    assert chamou


async def test_pg_manual_desabilitado_503(client, auth_admin, monkeypatch):
    async def _fake(**_kw):
        return {"ok": False, "motivo": "backup pg desabilitado"}
    monkeypatch.setattr(pg_backup, "backup_pg_agora", _fake)
    r = await client.post("/backup/pg",
                          headers={"Authorization": "Bearer x"})
    assert r.status_code == 503
    assert "desabilitado" in r.json()["detail"]


async def test_dados_manual_recepcao_403(client, auth_recep):
    r = await client.post("/backup/dados",
                          headers={"Authorization": "Bearer x"})
    assert r.status_code == 403
