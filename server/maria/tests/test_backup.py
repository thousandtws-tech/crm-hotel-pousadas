"""Testes do backup S3 — cliente falso, zero rede."""
import json

import pytest

from app.config import get_settings
from app.infra import backup
from app.infra.storage import JsonStore


class FakeS3:
    """Simula boto3.client("s3") — guarda objetos num dict."""

    def __init__(self, bucket_existe: bool = True):
        self.objetos: dict[str, bytes] = {}
        self.buckets = {"existente"} if bucket_existe else set()

    def head_bucket(self, Bucket):
        if Bucket not in self.buckets:
            from botocore.exceptions import ClientError
            raise ClientError({"Error": {"Code": "404"}}, "HeadBucket")

    def create_bucket(self, Bucket, **_kw):
        self.buckets.add(Bucket)

    def put_object(self, Bucket, Key, Body):
        self.objetos[Key] = Body

    def list_objects_v2(self, Bucket, Prefix, Delimiter=""):
        chaves = sorted(k for k in self.objetos if k.startswith(Prefix))
        pastas, arquivos = set(), []
        for k in chaves:
            resto = k[len(Prefix):]
            if Delimiter and Delimiter in resto:
                pastas.add(Prefix + resto.split(Delimiter)[0] + Delimiter)
            else:
                arquivos.append({"Key": k})
        out = {"Contents": arquivos}
        if pastas:
            out["CommonPrefixes"] = [{"Prefix": p} for p in sorted(pastas)]
        return out

    def delete_objects(self, Bucket, Delete):
        for o in Delete["Objects"]:
            self.objetos.pop(o["Key"], None)

    def get_paginator(self, _nome):
        class _Pag:
            def paginate(_, Bucket, Prefix):
                chaves = [k for k in self.objetos if k.startswith(Prefix)]
                yield {"Contents": [{"Key": k} for k in chaves]}
        return _Pag()


@pytest.fixture
def s3_env(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "maria_backup_enabled", True)
    monkeypatch.setattr(s, "maria_s3_bucket", "meu-bucket")
    monkeypatch.setattr(s, "maria_s3_prefix", "maria")
    monkeypatch.setattr(s, "maria_backup_retain", 2)
    return s


async def test_backup_envia_dump_e_arquivos(s3_env, tmp_path,
                                            monkeypatch):
    store = JsonStore(tmp_path)
    await store.append("memorias", {"id": "m1", "texto": "mem"})
    await store.kv_set("metricas", {"uso": {"turnos": 3}})
    fake = FakeS3()
    # simula arquivos locais
    d = tmp_path / "data"  # noqa: F841 — data/ é fixo; usar store só
    r = await backup.backup_agora(store, client_factory=lambda: fake)
    assert r["ok"]
    chaves = list(fake.objetos)
    assert any(k.endswith("dump/memorias.jsonl") for k in chaves)
    assert any(k.endswith("dump/kv/metricas.json") for k in chaves)
    mem = [k for k in chaves if k.endswith("memorias.jsonl")][0]
    assert json.loads(fake.objetos[mem].decode())["texto"] == "mem"


async def test_backup_desabilitado(s3_env, monkeypatch):
    monkeypatch.setattr(get_settings(), "maria_backup_enabled", False)
    r = await backup.backup_agora(client_factory=lambda: FakeS3())
    assert not r["ok"]


async def test_backup_poda_prefixos_antigos(s3_env, tmp_path):
    fake = FakeS3()
    store = JsonStore(tmp_path)
    # semeia 3 dias de backups — retain=2 deve podar o mais antigo
    for dia in ("2020-01-01", "2020-01-02", "2020-01-03"):
        fake.objetos[f"maria/{dia}/dump/x.jsonl"] = b"{}"
    r = await backup.backup_agora(store, client_factory=lambda: fake)
    assert r["ok"]
    assert not any(k.startswith("maria/2020-01-01/") for k in fake.objetos)
    assert any(k.startswith("maria/2020-01-03/") for k in fake.objetos)


def test_garantir_bucket_cria_quando_ausente():
    fake = FakeS3(bucket_existe=False)
    backup._garantir_bucket(fake, "novo", "us-east-1")
    assert "novo" in fake.buckets


def test_garantir_bucket_nao_recria_existente():
    fake = FakeS3(bucket_existe=False)
    fake.buckets.add("ja-existe")
    backup._garantir_bucket(fake, "ja-existe", "sa-east-1")
    assert fake.buckets == {"ja-existe"}          # sem churn


def test_garantir_bucket_engole_falha_de_criacao():
    class S3Rijido:
        def head_bucket(self, Bucket):
            raise PermissionError("sem acesso")
        def create_bucket(self, Bucket, **kw):
            raise PermissionError("sem acesso")
    # não levanta — put_object decidirá com o erro real
    backup._garantir_bucket(S3Rijido(), "x", "us-east-1")
