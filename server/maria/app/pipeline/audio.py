"""Helpers de áudio PCM — resample e conversão para STT/TTS locais.

O pipeline inteiro fala PCM16 mono 24 kHz; os engines locais usam
outras taxas (whisper 16 kHz float32, piper ~22050 int16). Centralizar
o resample aqui evita duplicar a matemática nos dois adapters.
"""
from __future__ import annotations

import numpy as np


def resample_pcm16(pcm: bytes, de: int, para: int) -> bytes:
    """PCM16 mono little-endian de `de` Hz para `para` Hz.

    Interpolação linear — suficiente para voz; sem dependência pesada
    (scipy/librosa seriam overkill p/ 2 taxas fixas).
    """
    if de == para or not pcm:
        return pcm
    x = np.frombuffer(pcm, dtype=np.int16)
    if len(x) < 2:
        return pcm
    n_out = int(round(len(x) * para / de))
    if n_out < 1:
        return b""
    idx = np.linspace(0, len(x) - 1, n_out)
    y = np.interp(idx, np.arange(len(x)), x.astype(np.float64))
    return np.clip(np.rint(y), -32768, 32767).astype(np.int16).tobytes()


def pcm16_para_float(pcm: bytes, de: int = 24000, para: int = 16000) -> np.ndarray:
    """PCM16 → float32 normalizado [-1, 1] na taxa esperada pelo whisper."""
    x = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
    if de != para and len(x) >= 2:
        n_out = int(round(len(x) * para / de))
        idx = np.linspace(0, len(x) - 1, n_out)
        x = np.interp(idx, np.arange(len(x)), x).astype(np.float32)
    return x
