"""Store — persistência intercambiável (ports & adapters).

Backend escolhido por `MARIA_STORAGE`:

- `"json"` (padrão): um arquivo por coleção em `data/` — memórias em
  array atômico, turnos em JSONL com rotação por tamanho. É o formato
  já existente: zero migração.
- `"sqlite"`: `data/maria.db` — adequado a volume e a futuras
  múltiplas instâncias. Na primeira abertura importa os JSONs
  legados (migração transparente).

Interface mínima — documentos dict por coleção + chave-valor:

    await store.append("turnos", {"pergunta": ...})
    await store.todos("memorias")           → list[dict]
    await store.salvar_todos("memorias", docs)
    await store.remover("memorias", "id", "m123")
    await store.kv_get("embeddings") / kv_set("metricas", {...})

Coleções mapeiam arquivos legados no backend JSON:
  memorias   → MARIA_MEMORY_FILE      (array JSON atômico)
  turnos     → MARIA_TRANSCRIPT_FILE  (JSONL + rotação)
  kv:<chave> → data/<chave>.json      (objeto JSON)
"""
from __future__ import annotations

import asyncio
import json
import logging
import sqlite3
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Protocol

from ..config import get_settings

log = logging.getLogger("maria.storage")

_TURNOS_MAX_LINHAS = 50_000  # poda do diário no backend sqlite


class Store(Protocol):
    """Contrato de persistência — os dois backends implementam igual."""

    async def append(self, colecao: str, doc: dict[str, Any]) -> None: ...
    async def todos(self, colecao: str) -> list[dict[str, Any]]: ...
    async def salvar_todos(self, colecao: str,
                           docs: list[dict[str, Any]]) -> None: ...
    async def remover(self, colecao: str, campo: str,
                      valor: Any) -> int: ...
    async def kv_get(self, chave: str) -> Any: ...
    async def kv_set(self, chave: str, valor: Any) -> None: ...
    async def fechar(self) -> None: ...


# ------------------------------------------------------------- helpers --

def _arquivo_colecao(colecao: str) -> Path:
    """Arquivo legado da coleção no backend JSON."""
    s = get_settings()
    if colecao == "memorias":
        p = Path(s.maria_memory_file)
    elif colecao == "turnos":
        p = Path(getattr(s, "maria_transcript_file", "") or "data/turns.jsonl")
    else:
        p = Path("data") / f"{colecao}.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def _le_json(p: Path, vazio: Any) -> Any:
    try:
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else vazio
    except Exception:
        return vazio


def _grava_atomico(p: Path, dado: Any) -> None:
    """tmp + replace — nunca deixa arquivo truncado."""
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(json.dumps(dado, ensure_ascii=False) + "\n",
                   encoding="utf-8")
    tmp.replace(p)


# ---------------------------------------------------------- backend JSON --

class JsonStore:
    """Um arquivo por coleção — formato legado, zero migração.

    `diretorio` injetável para os testes (redireciona coleções livres
    e kv; memorias/turnos continuam via settings).
    """

    def __init__(self, diretorio: Path | None = None) -> None:
        self._dir = diretorio
        self._lock = asyncio.Lock()

    def _arquivo(self, colecao: str) -> Path:
        if self._dir and colecao not in ("memorias", "turnos"):
            p = self._dir / f"{colecao}.json"
            p.parent.mkdir(parents=True, exist_ok=True)
            return p
        return _arquivo_colecao(colecao)

    async def append(self, colecao: str, doc: dict[str, Any]) -> None:
        async with self._lock:
            await asyncio.to_thread(self._append_sync, colecao, doc)

    def _append_sync(self, colecao: str, doc: dict[str, Any]) -> None:
        p = self._arquivo(colecao)
        if colecao == "turnos" or p.suffix == ".jsonl":
            self._girar(p)
            with open(p, "a", encoding="utf-8") as f:
                f.write(json.dumps(doc, ensure_ascii=False) + "\n")
        else:
            docs = _le_json(p, [])
            docs.append(doc)
            _grava_atomico(p, docs)

    def _girar(self, p: Path) -> None:
        """Rotação por tamanho — mantém 5 arquivos antigos."""
        s = get_settings()
        maxb = getattr(s, "maria_transcript_max_bytes", 10 * 1024 * 1024)
        try:
            if not p.exists() or p.stat().st_size < maxb:
                return
            antigos = sorted(p.parent.glob(p.stem + ".*.jsonl"),
                             key=lambda x: x.stat().st_mtime)
            for velho in antigos[:-4]:
                velho.unlink(missing_ok=True)
            p.rename(p.with_name(
                f"{p.stem}.{datetime.utcnow():%Y%m%d%H%M%S}.jsonl"))
        except Exception:
            log.exception("falha ao girar transcript")

    async def todos(self, colecao: str) -> list[dict[str, Any]]:
        return await asyncio.to_thread(self._todos_sync, colecao)

    def _todos_sync(self, colecao: str) -> list[dict[str, Any]]:
        p = self._arquivo(colecao)
        if p.suffix == ".jsonl" or colecao == "turnos":
            if not p.exists():
                return []
            out = []
            for linha in p.read_text(encoding="utf-8").splitlines():
                if not linha.strip():
                    continue
                try:
                    out.append(json.loads(linha))
                except json.JSONDecodeError:
                    continue
            return out
        return _le_json(p, [])

    async def salvar_todos(self, colecao: str,
                           docs: list[dict[str, Any]]) -> None:
        async with self._lock:
            await asyncio.to_thread(self._salvar_sync, colecao, docs)

    def _salvar_sync(self, colecao: str,
                     docs: list[dict[str, Any]]) -> None:
        _grava_atomico(self._arquivo(colecao), docs)

    async def remover(self, colecao: str, campo: str, valor: Any) -> int:
        async with self._lock:
            return await asyncio.to_thread(
                self._remover_sync, colecao, campo, valor)

    def _remover_sync(self, colecao: str, campo: str, valor: Any) -> int:
        docs = _le_json(self._arquivo(colecao), [])
        novos = [d for d in docs if d.get(campo) != valor]
        if len(novos) != len(docs):
            _grava_atomico(self._arquivo(colecao), novos)
        return len(docs) - len(novos)

    async def kv_get(self, chave: str) -> Any:
        return await asyncio.to_thread(self._kv_get_sync, chave)

    def _kv_get_sync(self, chave: str) -> Any:
        p = self._arquivo(chave)
        if p.name == f"{chave}.jsonl":
            p = p.with_suffix(".json")
        return _le_json(p, None)

    async def kv_set(self, chave: str, valor: Any) -> None:
        async with self._lock:
            await asyncio.to_thread(self._kv_set_sync, chave, valor)

    def _kv_set_sync(self, chave: str, valor: Any) -> None:
        _grava_atomico(self._arquivo(chave), valor)

    async def fechar(self) -> None:
        pass


# -------------------------------------------------------- backend sqlite --

class SqliteStore:
    """SQLite (stdlib) — um banco, coleções como tabelas lógicas.

    Concorrência: conexão única + lock; chamadas síncronas correm em
    thread para não bloquear o loop asyncio.
    """

    def __init__(self, arquivo: Path | None = None) -> None:
        self._arq = arquivo or Path(
            getattr(get_settings(), "maria_sqlite_file", "")
            or "data/maria.db")
        self._arq.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._db = sqlite3.connect(str(self._arq), check_same_thread=False)
        self._db.execute("""CREATE TABLE IF NOT EXISTS docs
            (colecao TEXT, doc TEXT)""")
        self._db.execute("""CREATE TABLE IF NOT EXISTS kv
            (chave TEXT PRIMARY KEY, valor TEXT)""")
        self._db.execute("CREATE INDEX IF NOT EXISTS ix_docs_colecao "
                         "ON docs(colecao)")
        self._db.commit()
        self._migrar_json()

    async def _run(self, fn):
        return await asyncio.to_thread(self._exec, fn)

    def _exec(self, fn):
        with self._lock:
            out = fn(self._db)
            self._db.commit()
            return out

    # -- migração única dos JSONs legados
    def _migrar_json(self) -> None:
        with self._lock:
            if self._db.execute(
                    "SELECT valor FROM kv WHERE chave='migrado'").fetchone():
                return
            n = 0
            for colecao in ("memorias", "turnos"):
                p = _arquivo_colecao(colecao)
                if not p.exists():
                    continue
                if p.suffix == ".jsonl":
                    docs = [json.loads(ln) for ln in
                            p.read_text(encoding="utf-8").splitlines()
                            if ln.strip()]
                else:
                    docs = _le_json(p, [])
                for d in docs:
                    self._db.execute(
                        "INSERT INTO docs(colecao, doc) VALUES (?, ?)",
                        (colecao, json.dumps(d, ensure_ascii=False)))
                    n += 1
            for chave in ("embeddings",):
                p = _arquivo_colecao(chave)
                if p.exists():
                    v = _le_json(p, None)
                    if v is not None:
                        self._db.execute(
                            "INSERT OR REPLACE INTO kv(chave, valor) "
                            "VALUES (?, ?)",
                            (chave, json.dumps(v, ensure_ascii=False)))
            self._db.execute(
                "INSERT OR REPLACE INTO kv(chave, valor) VALUES "
                "('migrado', '1')")
            self._db.commit()
            if n:
                log.info("migração JSON→sqlite: %d documentos", n)

    async def append(self, colecao: str, doc: dict[str, Any]) -> None:
        def op(db):
            db.execute("INSERT INTO docs(colecao, doc) VALUES (?, ?)",
                       (colecao, json.dumps(doc, ensure_ascii=False)))
            if colecao == "turnos":
                db.execute(
                    """DELETE FROM docs WHERE colecao = ? AND rowid <=
                       (SELECT MAX(rowid) FROM docs WHERE colecao = ?) - ?""",
                    (colecao, colecao, _TURNOS_MAX_LINHAS))
        await self._run(op)

    async def todos(self, colecao: str) -> list[dict[str, Any]]:
        def op(db):
            rows = db.execute(
                "SELECT doc FROM docs WHERE colecao = ? ORDER BY rowid",
                (colecao,)).fetchall()
            return [json.loads(r[0]) for r in rows]
        return await self._run(op)

    async def salvar_todos(self, colecao: str,
                           docs: list[dict[str, Any]]) -> None:
        def op(db):
            db.execute("DELETE FROM docs WHERE colecao = ?", (colecao,))
            for d in docs:
                db.execute("INSERT INTO docs(colecao, doc) VALUES (?, ?)",
                           (colecao, json.dumps(d, ensure_ascii=False)))
        await self._run(op)

    async def remover(self, colecao: str, campo: str, valor: Any) -> int:
        def op(db):
            docs = [json.loads(r[0]) for r in db.execute(
                "SELECT doc FROM docs WHERE colecao = ? ORDER BY rowid",
                (colecao,)).fetchall()]
            novos = [d for d in docs if d.get(campo) != valor]
            removidos = len(docs) - len(novos)
            if removidos:
                db.execute("DELETE FROM docs WHERE colecao = ?",
                           (colecao,))
                for d in novos:
                    db.execute(
                        "INSERT INTO docs(colecao, doc) VALUES (?, ?)",
                        (colecao, json.dumps(d, ensure_ascii=False)))
            return removidos
        return await self._run(op)

    async def kv_get(self, chave: str) -> Any:
        def op(db):
            r = db.execute("SELECT valor FROM kv WHERE chave = ?",
                           (chave,)).fetchone()
            return json.loads(r[0]) if r else None
        return await self._run(op)

    async def kv_set(self, chave: str, valor: Any) -> None:
        def op(db):
            db.execute(
                "INSERT OR REPLACE INTO kv(chave, valor) VALUES (?, ?)",
                (chave, json.dumps(valor, ensure_ascii=False)))
        await self._run(op)

    async def fechar(self) -> None:
        with self._lock:
            self._db.close()


# ------------------------------------------------------------ singleton --

_STORE: Store | None = None


def get_store() -> Store:
    """Store do processo, por MARIA_STORAGE (json|sqlite)."""
    global _STORE
    if _STORE is None:
        backend = getattr(get_settings(), "maria_storage", "json").lower()
        _STORE = SqliteStore() if backend == "sqlite" else JsonStore()
        log.info("store backend=%s", backend)
    return _STORE
