"""Diário de turnos — base de dados da MAR IA.

Cada turno vira um registro com pergunta, resposta, ferramentas
chamadas (args + resultado truncado), latências e uso de tokens. É o
dataset bruto que alimenta:
- `evals/` — golden sets a partir de turnos reais;
- revisão de qualidade — o que a MAR IA errou/acertou no dia a dia;
- `finetune/` — dataset SFT de treino.

Privacidade: registra o texto já falado/digitado no admin interno —
não coleta áudio. Campos sensíveis são redigidos. Desligável por
MARIA_TRANSCRIPT_ENABLED=false. Persistência via infra.storage (JSONL
com rotação por tamanho, ou SQLite conforme MARIA_STORAGE).
"""
import json
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Any

from ..config import get_settings
from .storage import _arquivo_colecao, get_store

log = logging.getLogger("maria.transcripts")

_COLECAO = "turnos"
_REDACT = ("senha", "password", "token", "secret", "cpf")
_RESULT_MAX = 1500


def _arquivo() -> Path:
    """Arquivo do diário no backend JSON (compat/estatísticas)."""
    return _arquivo_colecao(_COLECAO)


def _redige_args(args: Any) -> Any:
    """Remove valores de campos sensíveis (senha de funcionário etc.)."""
    if isinstance(args, dict):
        out = {}
        for k, v in args.items():
            out[k] = "***" if any(r in k.lower() for r in _REDACT) else _redige_args(v)
        return out
    if isinstance(args, list):
        return [_redige_args(v) for v in args]
    return args


def _limita_resultado(t: Any) -> Any:
    """Serializa e trunca o `result` da tool — já passou pela redação."""
    if not (isinstance(t, dict) and "result" in t):
        return t
    t = dict(t)
    try:
        t["result"] = json.dumps(t["result"], ensure_ascii=False)[:_RESULT_MAX]
    except (TypeError, ValueError):
        t["result"] = str(t["result"])[:_RESULT_MAX]
    return t


async def registrar(
    *,
    idfuncionario: int,
    origem: str,
    pergunta: str,
    resposta: str,
    tools: list[dict[str, Any]],
    latencias: dict[str, float],
    usage: dict[str, int] | None = None,
    turno: str = "",
) -> None:
    """Appenda um turno — falha nunca quebra o turno do usuário."""
    s = get_settings()
    if not getattr(s, "maria_transcript_enabled", False):
        return
    registro = {
        "ts": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "turno": turno,
        "idfuncionario": idfuncionario,
        "origem": origem,
        "pergunta": pergunta[:2000],
        "resposta": resposta[:4000],
        "tools": [_limita_resultado(t) for t in _redige_args(tools)[:20]],
        "latencias": {k: round(v, 3) for k, v in latencias.items()},
        "usage": usage or {},
    }
    try:
        await get_store().append(_COLECAO, registro)
    except Exception:
        log.exception("falha ao registrar turno")


def _le_jsonl(p: Path, limite: int) -> list[dict[str, Any]]:
    if not p.exists():
        return []
    try:
        linhas = p.read_text(encoding="utf-8").strip().splitlines()
        return [json.loads(x) for x in linhas[-limite:] if x.strip()]
    except Exception:
        log.exception("falha ao ler transcript")
        return []


def ler(limite: int = 200, arquivo: str | None = None) -> list[dict[str, Any]]:
    """Leitura síncrona — arquivo JSONL do disco.

    Com backend JSON, lê o arquivo configurado; `arquivo` explícito
    serve para revisar arquivos rotacionados. Com backend sqlite, use
    `ler_async`.
    """
    if getattr(get_settings(), "maria_storage", "json").lower() != "json" \
            and not arquivo:
        log.warning("ler() em backend sqlite retorna vazio — use ler_async")
        return []
    return _le_jsonl(Path(arquivo) if arquivo else _arquivo(), limite)


async def ler_async(limite: int = 200, arquivo: str | None = None
                    ) -> list[dict[str, Any]]:
    """Leitura assíncrona — funciona com qualquer backend."""
    if arquivo:
        return _le_jsonl(Path(arquivo), limite)
    docs = await get_store().todos(_COLECAO)
    return docs[-limite:]


def estatisticas(arquivo: str | None = None) -> dict[str, Any]:
    """Resumo do dataset — usado pelo relatório dos evals."""
    p = Path(arquivo) if arquivo else _arquivo()
    if not p.exists():
        return {"turnos": 0, "arquivo": str(p)}
    n = 0
    tools: dict[str, int] = {}
    try:
        for linha in p.read_text(encoding="utf-8").splitlines():
            if not linha.strip():
                continue
            n += 1
            try:
                for t in json.loads(linha).get("tools", []):
                    nome = t.get("name", "?")
                    tools[nome] = tools.get(nome, 0) + 1
            except json.JSONDecodeError:
                continue
    except OSError:
        pass
    top = sorted(tools.items(), key=lambda kv: -kv[1])[:15]
    return {
        "turnos": n,
        "arquivo": str(p),
        "bytes": os.path.getsize(p),
        "top_tools": dict(top),
    }
