"""Métricas de latência por estágio do pipeline (p50/p95 simples)."""
import statistics
import threading
import time
from collections import deque


class Latencia:
    """Medidor por turno — marque estágios e calcule p50/p95."""

    _lock = threading.Lock()
    _series: dict[str, deque[float]] = {
        "stt_final": deque(maxlen=200),      # fala → transcrição final
        "llm_primeiro_token": deque(maxlen=200),
        "tool_exec": deque(maxlen=200),
        "tts_primeiro_audio": deque(maxlen=200),
        "resposta_total": deque(maxlen=200), # fala → primeiro áudio audível
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
