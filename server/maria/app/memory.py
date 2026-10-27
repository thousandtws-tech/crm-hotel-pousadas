"""Memória persistente do MAR IA — aprendizado no dia a dia.

Padrão dos copilotos grandes: memória EXPLÍCITA (o modelo decide
registrar via ferramenta), escopo por usuário ou pousada, injeção das
memórias relevantes no contexto a cada turno, e possibilidade de
esquecer. LGPD: só se guarda o que o usuário pede ou corrige; nada de
áudio nem PII desnecessária.

Armazenamento: arquivo JSON atômico (`data/memories.json`) — pequeno,
auditável, sem dependência nova. Configurável por MARIA_MEMORY_FILE.
"""
import asyncio
import json
import logging
import re
import tempfile
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from .config import get_settings

log = logging.getLogger("maria.memory")

_LOCK = asyncio.Lock()
_MAX = 300          # teto global de memórias
_POR_ESCOPO = 150   # teto por escopo
_STOP = {
    "para", "com", "uma", "que", "dos", "das", "por", "seu", "sua",
    "tem", "ter", "esta", "este", "isso", "esse", "quando", "onde",
    "como", "mais", "mais", "sobre", "tambem", "the",
}


def _arquivo() -> Path:
    s = get_settings()
    p = Path(getattr(s, "maria_memory_file", "") or "data/memories.json")
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def _carregar() -> list[dict[str, Any]]:
    p = _arquivo()
    if not p.exists():
        return []
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        log.exception("memória corrompida — reiniciando vazia")
        return []


def _salvar(items: list[dict[str, Any]]) -> None:
    p = _arquivo()
    fd, tmp = tempfile.mkstemp(dir=str(p.parent), suffix=".tmp")
    with open(fd, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=1)
    Path(tmp).replace(p)


def _norm(t: str) -> str:
    return re.sub(r"\s+", " ", t.strip().lower())


def _tokens(t: str) -> set[str]:
    return {w for w in re.findall(r"[a-zà-ú0-9]{4,}", t.lower()) if w not in _STOP}


async def lembrar(escopo: str, idfuncionario: int | None, texto: str,
                  fonte: str = "conversa") -> dict[str, Any]:
    """Registra uma memória durável. Dedup por texto normalizado."""
    texto = texto.strip()
    if not texto or len(texto) < 4:
        return {"ok": False, "mensagem": "texto vazio"}
    if len(texto) > 280:
        texto = texto[:280]
    async with _LOCK:
        items = _carregar()
        alvo = _norm(texto)
        for m in items:
            if (m["escopo"] == escopo
                    and m.get("idfuncionario") == idfuncionario
                    and _norm(m["texto"]) == alvo):
                m["visto_em"] = datetime.utcnow().isoformat(timespec="seconds") + "Z"
                m["usos"] = m.get("usos", 0) + 1
                _salvar(items)
                return {"ok": True, "id": m["id"], "mensagem": "memória atualizada"}
        novo = {
            "id": uuid.uuid4().hex[:10],
            "escopo": escopo,
            "idfuncionario": idfuncionario,
            "texto": texto,
            "fonte": fonte,
            "criado_em": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "usos": 0,
        }
        items.append(novo)
        # teto por escopo: remove as mais velhas e menos usadas
        mesmo = [m for m in items if m["escopo"] == escopo]
        if len(mesmo) > _POR_ESCOPO:
            velhas = sorted(mesmo, key=lambda m: (m.get("usos", 0), m["criado_em"]))
            tirar = {m["id"] for m in velhas[: len(mesmo) - _POR_ESCOPO]}
            items = [m for m in items if m["id"] not in tirar]
        items = items[-_MAX:]
        _salvar(items)
    log.info("memória salva [%s] %s", escopo, texto[:80])
    return {"ok": True, "id": novo["id"], "mensagem": "memorizado"}


async def esquecer(idmemoria: str) -> dict[str, Any]:
    async with _LOCK:
        items = _carregar()
        n = len(items)
        items = [m for m in items if m["id"] != idmemoria]
        _salvar(items)
    return {"ok": n != len(items), "mensagem": "esquecido" if n != len(items) else "não achei essa memória"}


async def listar(ator_id: int, limite: int = 40) -> list[dict[str, Any]]:
    items = _carregar()
    return [
        {"id": m["id"], "escopo": m["escopo"], "texto": m["texto"]}
        for m in items
        if m["escopo"] == "pousada" or m.get("idfuncionario") == ator_id
    ][-limite:]


async def relevantes(ator_id: int, consulta: str, limite: int = 12) -> list[str]:
    """Memórias para injetar no contexto — escopo pousada + do usuário,
    ranqueadas por sobreposição de palavras + recência."""
    items = [
        m for m in _carregar()
        if m["escopo"] == "pousada" or m.get("idfuncionario") == ator_id
    ]
    if not items:
        return []
    q = _tokens(consulta)
    pontos = []
    for i, m in enumerate(items):
        score = len(q & _tokens(m["texto"])) * 3 + i * 0.01 + min(m.get("usos", 0), 5) * 0.2
        pontos.append((score, m))
    pontos.sort(key=lambda x: -x[0])
    escopo_nome = {"pousada": "pousada", "usuario": "usuário"}
    return [
        f"[{escopo_nome.get(m['escopo'], m['escopo'])}] {m['texto']}"
        for _, m in pontos[:limite]
    ]
