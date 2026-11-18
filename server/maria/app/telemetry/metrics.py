"""Métricas operacionais — latência p50/p95 por estágio e contadores
de uso (tokens, ferramentas, erros) para custo e observabilidade.

Persistência: `persistir`/`restaurar` gravam um snapshot no store
(kv "metricas") — sobrevive a restart e é a base para agregação
multi-instância. `prometheus()` expõe no formato text/plain padrão
para scraping (endpoint /metrics.prom)."""
import logging
import statistics
import threading
import time
from collections import deque
from typing import Any

log = logging.getLogger("maria.metrics")

_KV_CHAVE = "metricas"


class Uso:
    """Contadores globais de uso — tokens LLM, ferramentas e erros.

    Alimenta o /metrics e permite estimar custo por sessão/período sem
    depender de observabilidade externa.
    """

    _lock = threading.Lock()
    _contadores: dict[str, int] = {
        "turnos": 0,
        "turnos_erro": 0,
        "llm_chamadas": 0,
        "tokens_input": 0,
        "tokens_output": 0,
        "tokens_cached": 0,
        "tool_calls": 0,
        "tool_erros": 0,
        "acoes_executadas": 0,
        "backup_pg_ok": 0,
        "backup_pg_erros": 0,
        "backup_dados_ok": 0,
        "backup_dados_erros": 0,
    }
    _por_ferramenta: dict[str, int] = {}

    @classmethod
    def inc(cls, chave: str, valor: int = 1) -> None:
        with cls._lock:
            cls._contadores[chave] = cls._contadores.get(chave, 0) + valor

    @classmethod
    def tool(cls, nome: str, erro: bool = False) -> None:
        with cls._lock:
            cls._por_ferramenta[nome] = cls._por_ferramenta.get(nome, 0) + 1
            cls._contadores["tool_calls"] += 1
            if erro:
                cls._contadores["tool_erros"] += 1

    @classmethod
    def tokens(cls, usage: object) -> None:
        """Soma `response.usage` da Responses API (input/output/cached)."""
        if usage is None:
            return
        inp = getattr(usage, "input_tokens", 0) or 0
        out = getattr(usage, "output_tokens", 0) or 0
        cached = getattr(getattr(usage, "input_tokens_details", None),
                         "cached_tokens", 0) or 0
        with cls._lock:
            cls._contadores["tokens_input"] += int(inp)
            cls._contadores["tokens_output"] += int(out)
            cls._contadores["tokens_cached"] += int(cached)
            cls._contadores["llm_chamadas"] += 1

    @classmethod
    def resumo(cls) -> dict[str, object]:
        with cls._lock:
            top = sorted(cls._por_ferramenta.items(), key=lambda kv: -kv[1])[:12]
            return {**cls._contadores, "top_ferramentas": dict(top)}

    @classmethod
    def snapshot(cls) -> dict[str, Any]:
        """Estado serializável — contadores + distribuição por tool."""
        with cls._lock:
            return {**cls._contadores,
                    "por_ferramenta": dict(cls._por_ferramenta)}

    @classmethod
    def restaurar(cls, d: dict[str, Any]) -> None:
        """Soma um snapshot anterior (restart soma, nunca subtrai)."""
        if not isinstance(d, dict):
            return
        with cls._lock:
            for k, v in d.items():
                if k == "por_ferramenta":
                    continue
                if isinstance(v, (int, float)):
                    cls._contadores[k] = cls._contadores.get(k, 0) + int(v)
            for nome, n in (d.get("por_ferramenta") or {}).items():
                cls._por_ferramenta[nome] = \
                    cls._por_ferramenta.get(nome, 0) + int(n)


class Latencia:
    """Medidor por turno — marque estágios e calcule p50/p95."""

    _lock = threading.Lock()
    _series: dict[str, deque[float]] = {
        "stt_final": deque(maxlen=200),
        "llm_primeiro_token": deque(maxlen=200),
        "tool_exec": deque(maxlen=200),
        "tts_primeiro_audio": deque(maxlen=200),
        "resposta_total": deque(maxlen=200),
    }

    def __init__(self) -> None:
        self._marks: dict[str, float] = {}

    def mark(self, estagio: str) -> None:
        self._marks[estagio] = time.perf_counter()

    def desde(self, estagio_ini: str, serie: str) -> float:
        """Registra o tempo desde `estagio_ini` na série `serie`."""
        if estagio_ini not in self._marks:
            return -1
        dt = time.perf_counter() - self._marks[estagio_ini]
        with Latencia._lock:
            if serie in Latencia._series:
                Latencia._series[serie].append(dt)
        return dt

    @classmethod
    def resumo(cls) -> dict[str, dict[str, float]]:
        with cls._lock:
            out: dict[str, dict[str, float]] = {}
            for nome, serie in cls._series.items():
                vals = sorted(serie)
                if not vals:
                    out[nome] = {"n": 0, "p50": 0, "p95": 0, "media": 0}
                    continue
                p50 = statistics.median(vals)
                p95 = vals[min(int(len(vals) * 0.95), len(vals) - 1)]
                out[nome] = {
                    "n": len(vals),
                    "p50": round(p50, 3),
                    "p95": round(p95, 3),
                    "media": round(statistics.mean(vals), 3),
                }
            return out

    @classmethod
    def snapshot(cls) -> dict[str, list[float]]:
        with cls._lock:
            return {nome: list(serie) for nome, serie in cls._series.items()}

    @classmethod
    def restaurar(cls, d: dict[str, Any]) -> None:
        """Recoloca amostras de um snapshot (mais antigas → maxlen)."""
        if not isinstance(d, dict):
            return
        with cls._lock:
            for nome, vals in d.items():
                if nome in cls._series and isinstance(vals, list):
                    for v in vals:
                        if isinstance(v, (int, float)):
                            cls._series[nome].appendleft(float(v))


async def restaurar_metricas(store) -> None:
    """Boot: soma o snapshot gravado no store aos contadores do processo."""
    try:
        d = await store.kv_get(_KV_CHAVE)
        if not isinstance(d, dict):
            return
        Uso.restaurar(d.get("uso") or {})
        Latencia.restaurar(d.get("latencia") or {})
        log.info("métricas restauradas (turnos=%s)",
                 (d.get("uso") or {}).get("turnos", 0))
    except Exception:
        log.exception("falha ao restaurar métricas")


async def persistir_metricas(store) -> None:
    """Grava snapshot acumulado — chamado periodicamente e no shutdown."""
    try:
        await store.kv_set(_KV_CHAVE, {
            "uso": Uso.snapshot(),
            "latencia": Latencia.snapshot(),
            "ts": time.time(),
        })
    except Exception:
        log.exception("falha ao persistir métricas")


def prometheus() -> str:
    """Exposição text/plain no formato do Prometheus."""
    linhas = [
        "# HELP maria_turnos_total Turnos processados",
        "# TYPE maria_turnos_total counter",
    ]
    uso = Uso.resumo()
    for k in ("turnos", "turnos_erro", "llm_chamadas", "tokens_input",
              "tokens_output", "tokens_cached", "tool_calls", "tool_erros",
              "acoes_executadas", "backup_pg_ok", "backup_pg_erros",
              "backup_dados_ok", "backup_dados_erros"):
        nome = f"maria_{k}_total"
        linhas += [f"# TYPE {nome} counter", f"{nome} {uso.get(k, 0)}"]
    for nome, n in (uso.get("top_ferramentas") or {}).items():
        linhas.append(f'maria_tool_calls_total{{tool="{nome}"}} {n}')
    for estagio, m in Latencia.resumo().items():
        for quant in ("p50", "p95", "media"):
            linhas.append(
                f'maria_latencia_segundos{{estagio="{estagio}",'
                f'medida="{quant}"}} {m[quant]}')
    return "\n".join(linhas) + "\n"
