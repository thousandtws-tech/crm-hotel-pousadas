"""Divisor de sentenças — fatia o stream do LLM em segmentos faláveis
para a síntese incremental na ElevenLabs.
"""
import re

_CORTE = re.compile(r"(?<=[.!?…:;])\s+|\n+")


class SentenceBuffer:
    def __init__(self, min_len: int = 24):
        self._buf = ""
        self.min_len = min_len

    def push(self, delta: str) -> list[str]:
        """Acumula delta e devolve sentenças completas prontas para TTS."""
        self._buf += delta
        prontas: list[str] = []
        while True:
            m = _CORTE.search(self._buf)
            if not m:
                break
            s = self._buf[: m.end()].strip()
            resto = self._buf[m.end():]
            if len(s) >= self.min_len or len(resto) > 120:
                if s:
                    prontas.append(s)
                self._buf = resto
            else:
                break
        return prontas

    def flush(self) -> str | None:
        """Resto final da resposta (pode não terminar com pontuação)."""
        s = self._buf.strip()
        self._buf = ""
        return s or None
