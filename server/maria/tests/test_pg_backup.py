"""Testes do backup Postgres→S3 — pg_dump e S3 falsos, zero rede/DB."""
import gzip
import logging
from datetime import datetime, timezone

import pytest
from test_backup import FakeS3

from app.config import get_settings
from app.infra import pg_backup
from app.telemetry.metrics import Uso

_URL = "postgres://maria:S3NH4-S3CR3T4@db.interno:5432/pousada"


@pytest.fixture
def pg_env(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "backup_database_url", _URL)
    monkeypatch.setattr(s, "maria_s3_bucket", "meu-bucket")
    return s


def _dump_ok(payload: bytes = b"PGDUMP-BIN"):
    async def _fake(url: str) -> bytes:
        assert url == _URL  # DSN repassada ao subprocesso
        return payload
    return _fake


async def test_backup_pg_envia_gzip(pg_env, monkeypatch):
    fake = FakeS3()
    monkeypatch.setattr(pg_backup, "_rodar_pg_dump", _dump_ok())
    r = await pg_backup.backup_pg_agora(client_factory=lambda: fake)
    assert r["ok"]
    [chave] = [k for k in fake.objetos if k.startswith("backups/pg/")]
    assert chave.startswith("backups/pg/maria-pg-")
    assert chave.endswith(".dump.gz")
    assert gzip.decompress(fake.objetos[chave]) == b"PGDUMP-BIN"


def test_backup_pg_gate(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "backup_database_url", "")
    monkeypatch.setattr(s, "maria_s3_bucket", "meu-bucket")
    assert not pg_backup.backup_pg_habilitado()   # sem DSN → task não nasce
    monkeypatch.setattr(s, "backup_database_url", _URL)
    monkeypatch.setattr(s, "maria_s3_bucket", "")
    assert not pg_backup.backup_pg_habilitado()   # sem bucket → idem
    monkeypatch.setattr(s, "maria_s3_bucket", "meu-bucket")
    assert pg_backup.backup_pg_habilitado()


async def test_backup_pg_sem_url_nao_roda_dump(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "backup_database_url", "")
    chamou = False

    async def _dump(_url):
        nonlocal chamou
        chamou = True
        return b""

    monkeypatch.setattr(pg_backup, "_rodar_pg_dump", _dump)
    r = await pg_backup.backup_pg_agora(client_factory=lambda: FakeS3())
    assert not r["ok"]
    assert not chamou


async def test_backup_pg_poda_dumps_antigos(pg_env, monkeypatch):
    monkeypatch.setattr(pg_env, "maria_backup_retain", 2)
    fake = FakeS3()
    # semeia 5 dumps antigos — retain=2 + o novo ⇒ só 2 sobem de fato
    for i in range(1, 6):
        fake.objetos[f"backups/pg/maria-pg-2020010{i}-000000.dump.gz"] = b"x"
    monkeypatch.setattr(pg_backup, "_rodar_pg_dump", _dump_ok())
    r = await pg_backup.backup_pg_agora(client_factory=lambda: fake)
    assert r["ok"]
    restantes = sorted(fake.objetos)
    assert len(restantes) == 2                       # os 2 mais novos
    assert restantes[0].endswith("20200105-000000.dump.gz")
    assert all(k.startswith("backups/pg/") for k in restantes)


async def test_backup_pg_falha_vira_log_e_metrica(pg_env, monkeypatch,
                                                  caplog):
    async def _falha(_url):
        raise RuntimeError(f"pg_dump rc=1 — conexão recusada em {_URL}")

    monkeypatch.setattr(pg_backup, "_rodar_pg_dump", _falha)
    antes = Uso.resumo().get("backup_pg_erros", 0)
    with caplog.at_level(logging.ERROR, logger="maria.backup.pg"):
        r = await pg_backup.backup_pg_agora(client_factory=lambda: FakeS3())
    assert not r["ok"]                              # sem exceção propagada
    assert Uso.resumo()["backup_pg_erros"] == antes + 1
    texto = "\n".join(rec.getMessage() for rec in caplog.records)
    assert "backup pg falhou" in texto
    assert _URL not in texto                        # DSN/senha sanitizadas
    assert "S3NH4-S3CR3T4" not in texto


def test_atraso_inicial_proxima_janela():
    antes = datetime(2025, 1, 1, 3, 0, tzinfo=timezone.utc)
    depois = datetime(2025, 1, 1, 5, 0, tzinfo=timezone.utc)
    assert pg_backup._atraso_inicial(antes) == 3600          # ida às 04:00
    assert pg_backup._atraso_inicial(depois) == 23 * 3600    # só amanhã
