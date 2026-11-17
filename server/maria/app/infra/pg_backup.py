"""Backup agendado do Postgres para S3-compatível (AWS S3 ou MinIO).

Pipeline por execução: `pg_dump --format=custom` num subprocesso →
gzip → `s3://BUCKET/backups/pg/maria-pg-<AAAAMMDD-HHMMSS>.dump.gz` →
poda dos dumps além dos `maria_backup_retain` mais recentes.

Env-gate: sem BACKUP_DATABASE_URL + MARIA_S3_BUCKET a task nem inicia
(`backup_pg_habilitado`). A DSN é env própria — separada do
DATABASE_URL da API: a MAR IA não abre conexão com o banco, só executa
o binário. Como carrega senha embutida, nunca vai para o log — erros
passam por `_sanitizar`.

Falha de um ciclo → log.error + métrica `backup_pg_erros`; o loop
segue e o próximo ciclo tenta de novo — backup nunca derruba o
serviço.
"""
from __future__ import annotations

import asyncio
import gzip
import logging
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from typing import Any

from ..config import get_settings
from ..telemetry.metrics import Uso
from .backup import _client as _s3_client

log = logging.getLogger("maria.backup.pg")

_RAIZ = "backups/pg"
_HORA_UTC = 4  # janela diária ~04:00 UTC — madrugada, baixa demanda


def backup_pg_habilitado() -> bool:
    """True quando a task deve nascer — DSN do backup + bucket S3."""
    s = get_settings()
    return bool(s.backup_database_url and s.maria_s3_bucket)


def _atraso_inicial(agora: datetime | None = None) -> float:
    """Segundos até a próxima janela diária (_HORA_UTC UTC).

    Não roda no boot: o dump pesa I/O do banco e disputaria CPU/rede
    com o warmup do serviço — janela fixa de madrugada é gentil com a
    operação e previsível para auditoria.
    """
    agora = agora or datetime.now(timezone.utc)
    alvo = agora.replace(hour=_HORA_UTC, minute=0, second=0, microsecond=0)
    if alvo <= agora:
        alvo += timedelta(days=1)
    return (alvo - agora).total_seconds()


def _sanitizar(msg: str, url: str) -> str:
    """Remove a DSN (senha embutida) de qualquer texto destinado a log."""
    return msg.replace(url, "***") if url else msg


async def _rodar_pg_dump(url: str) -> bytes:
    """pg_dump custom-format via subprocesso — fora do event loop.

    --no-owner/--no-acl: dump restaurável por outra role (restore em
    staging/MinIO de DR não depende do usuário original).
    """
    proc = await asyncio.create_subprocess_exec(
        "pg_dump", "--format=custom", "--no-owner", "--no-acl", url,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    out, err = await proc.communicate()
    if proc.returncode != 0:
        detalhe = _sanitizar(err.decode("utf-8", "replace")[:500], url)
        raise RuntimeError(f"pg_dump rc={proc.returncode} — {detalhe}")
    return out


def _podar(client, bucket: str, raiz: str, manter: int) -> int:
    """Apaga os dumps além dos `manter` mais recentes.

    Chaves são timestampadas ⇒ ordem lexicográfica = cronológica.
    """
    chaves: list[str] = []
    pag = client.get_paginator("list_objects_v2")
    for page in pag.paginate(Bucket=bucket, Prefix=f"{raiz}/"):
        chaves += [o["Key"] for o in page.get("Contents", [])]
    excedente = sorted(chaves)[: max(0, len(chaves) - manter)]
    for i in range(0, len(excedente), 1000):  # delete_objects: teto 1000
        lote = [{"Key": k} for k in excedente[i: i + 1000]]
        client.delete_objects(Bucket=bucket, Delete={"Objects": lote})
    return len(excedente)


async def backup_pg_agora(client_factory: Callable = _s3_client) -> dict[str, Any]:
    """Uma execução de backup do Postgres — estatísticas (ou erro).

    Nunca levanta: falha vira log.error + métrica e o ciclo seguinte
    tenta de novo.
    """
    s = get_settings()
    if not backup_pg_habilitado():
        return {"ok": False, "motivo": "backup pg desabilitado"}
    url = s.backup_database_url
    chave = (f"{_RAIZ}/maria-pg-"
             f"{datetime.now(timezone.utc):%Y%m%d-%H%M%S}.dump.gz")
    try:
        bruto = await _rodar_pg_dump(url)

        def _sync() -> dict[str, Any]:
            client = client_factory()
            client.put_object(Bucket=s.maria_s3_bucket, Key=chave,
                              Body=gzip.compress(bruto))
            podados = _podar(client, s.maria_s3_bucket, _RAIZ,
                             s.maria_backup_retain)
            return {"chave": chave, "bytes": len(bruto), "podados": podados}

        stats = await asyncio.to_thread(_sync)
        Uso.inc("backup_pg_ok")
        log.info("backup pg ok — %s (%d B, podados %d)",
                 stats["chave"], stats["bytes"], stats["podados"])
        return {"ok": True, **stats}
    except Exception as exc:
        Uso.inc("backup_pg_erros")
        log.error("backup pg falhou — %s",
                  _sanitizar(str(exc) or type(exc).__name__, url))
        return {"ok": False, "motivo": "falha no backup pg — ver log"}


async def backup_pg_periodico() -> None:
    """Loop do lifespan — 1ª execução na janela diária, depois a cada
    `maria_backup_interval_h` horas. Falhas são absorvidas por
    `backup_pg_agora` e não derrubam a tarefa nem o serviço.
    """
    s = get_settings()
    await asyncio.sleep(_atraso_inicial())
    while True:
        await backup_pg_agora()
        await asyncio.sleep(s.maria_backup_interval_h * 3600)
