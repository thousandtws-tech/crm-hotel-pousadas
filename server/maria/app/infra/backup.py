"""Backup do data/ para S3-compatível (AWS S3 ou MinIO).

Estratégia por execução (prefixo datado <prefix>/<AAAA-MM-DD>/):
- `dump/` — export portável do store (memorias/turnos em JSONL,
  chaves kv em JSON): restaurável em qualquer backend;
- `files/` — arquivos crus de data/ (json/jsonl/db, inclui rotações).

Retenção: mantém os últimos `maria_backup_retain` dias.

MinIO: preencha MARIA_S3_ENDPOINT (path-style é forçado, padrão do
MinIO). AWS S3: deixe o endpoint vazio. Desligado por padrão —
MARIA_BACKUP_ENABLED=true + bucket/credenciais para ativar.
"""
from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Any

from ..config import get_settings
from ..telemetry.metrics import Uso

log = logging.getLogger("maria.backup")

_COLECOES = ("memorias", "turnos")
_KVS = ("embeddings", "metricas")
_EXTENSOES = {".json", ".jsonl", ".db"}


def _client():
    """Cliente boto3 — endpoint preenchido ⇒ MinIO/self-hosted."""
    import boto3
    from botocore.config import Config

    s = get_settings()
    kw: dict[str, Any] = {
        "aws_access_key_id": s.maria_s3_access_key or None,
        "aws_secret_access_key": s.maria_s3_secret_key or None,
        "region_name": s.maria_s3_region,
    }
    if s.maria_s3_endpoint:
        kw["endpoint_url"] = s.maria_s3_endpoint
        kw["config"] = Config(s3={"addressing_style": "path"})
    return boto3.client("s3", **kw)


def _garantir_bucket(client, bucket: str, region: str) -> None:
    """Cria o bucket se não existir — MinIO não auto-cria.

    Best-effort idempotente: head_bucket ok → nada a fazer; falhou →
    create_bucket; create falhou (permissão, corrida) → deixa o
    put_object levantar o erro real em vez de mascarar aqui.
    """
    try:
        client.head_bucket(Bucket=bucket)
        return
    except Exception:
        pass
    try:
        kw: dict[str, Any] = {}
        if region and region != "us-east-1":
            kw["CreateBucketConfiguration"] = {
                "LocationConstraint": region}
        client.create_bucket(Bucket=bucket, **kw)
        log.info("bucket %s criado", bucket)
    except Exception as exc:
        log.warning("create_bucket %s falhou (%s) — "
                    "upload decide", bucket, type(exc).__name__)


def _arquivos_data() -> list[Path]:
    """Arquivos persistidos locais (backend json + sqlite + rotações)."""
    d = Path("data")
    if not d.is_dir():
        return []
    return sorted(p for p in d.rglob("*")
                  if p.is_file()
                  and p.suffix in _EXTENSOES
                  and not p.name.endswith(".tmp"))


async def _dump_store(store) -> dict[str, str]:
    """Export portável: chave S3 → conteúdo (JSONL/JSON)."""
    out: dict[str, str] = {}
    for c in _COLECOES:
        docs = await store.todos(c)
        if docs:
            out[f"dump/{c}.jsonl"] = "".join(
                json.dumps(d, ensure_ascii=False) + "\n" for d in docs)
    for k in _KVS:
        v = await store.kv_get(k)
        if v is not None:
            out[f"dump/kv/{k}.json"] = json.dumps(
                v, ensure_ascii=False)
    return out


def _upload(client, bucket: str, prefixo: str,
            objetos: dict[str, bytes]) -> int:
    n = 0
    for chave, corpo in objetos.items():
        client.put_object(Bucket=bucket, Key=f"{prefixo}/{chave}",
                          Body=corpo)
        n += 1
    return n


def _podar(client, bucket: str, raiz: str, manter: int) -> int:
    """Remove prefixos datados além dos `manter` mais recentes."""
    resp = client.list_objects_v2(Bucket=bucket, Prefix=f"{raiz}/",
                                  Delimiter="/")
    pastas = sorted(p["Prefix"] for p in resp.get("CommonPrefixes", []))
    excedente = pastas[: max(0, len(pastas) - manter)]
    removidos = 0
    for pasta in excedente:
        pag = client.get_paginator("list_objects_v2")
        for page in pag.paginate(Bucket=bucket, Prefix=pasta):
            objs = [{"Key": o["Key"]} for o in page.get("Contents", [])]
            if objs:
                client.delete_objects(Bucket=bucket,
                                      Delete={"Objects": objs})
                removidos += len(objs)
    return removidos


async def backup_agora(store=None,
                       client_factory: Callable = _client) -> dict[str, Any]:
    """Uma execução de backup — retorna estatísticas (ou erro)."""
    from .storage import get_store

    s = get_settings()
    if not s.maria_backup_enabled or not s.maria_s3_bucket:
        return {"ok": False, "motivo": "backup desabilitado"}
    store = store or get_store()

    dumps = await _dump_store(store)
    arquivos = _arquivos_data()
    dia = datetime.utcnow().strftime("%Y-%m-%d")

    def _sync() -> dict[str, Any]:
        client = client_factory()
        bucket, raiz = s.maria_s3_bucket, s.maria_s3_prefix.rstrip("/")
        _garantir_bucket(client, bucket, s.maria_s3_region)
        n = _upload(client, bucket, f"{raiz}/{dia}",
                    {k: v.encode("utf-8") for k, v in dumps.items()})
        n += _upload(client, bucket, f"{raiz}/{dia}", {
            f"files/{p.relative_to('data').as_posix()}": p.read_bytes()
            for p in arquivos})
        podados = _podar(client, bucket, raiz, s.maria_backup_retain)
        return {"enviados": n, "podados": podados,
                "prefixo": f"{raiz}/{dia}"}

    try:
        stats = await asyncio.to_thread(_sync)
        Uso.inc("backup_dados_ok")
        log.info("backup ok — %s objetos em %s (podados %s)",
                 stats["enviados"], stats["prefixo"], stats["podados"])
        return {"ok": True, **stats}
    except Exception:
        Uso.inc("backup_dados_erros")
        log.exception("backup falhou")
        return {"ok": False, "motivo": "falha no upload — ver log"}


async def backup_periodico(store=None) -> None:
    """Loop do lifespan — dorme `interval_h` e executa `backup_agora`.

    Falhas são logadas e não derrubam a tarefa nem o serviço.
    """
    s = get_settings()
    await asyncio.sleep(s.maria_backup_interval_h * 3600)
    while True:
        await backup_agora(store)
        await asyncio.sleep(s.maria_backup_interval_h * 3600)
