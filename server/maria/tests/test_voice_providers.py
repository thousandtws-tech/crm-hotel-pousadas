"""Testes offline dos provedores locais de voz — whisper STT e piper
TTS. Nenhum modelo real é carregado: faster-whisper e PiperVoice são
fakes injetados nos adapters; nada baixa da rede nem toca em disco.
"""
import asyncio
from types import SimpleNamespace

import numpy as np

from app.config import Settings
from app.pipeline.audio import pcm16_para_float, resample_pcm16
from app.pipeline.stt import WhisperLocalStt, _VadEnergia, _VadWebrtc
from app.pipeline.tts import PiperTts

# ------------------------------------------------------------- helpers --


def _pcm(ms: int, amp: int = 12000, rate: int = 24000) -> bytes:
    """PCM16 constante com `amp` — RMS alto p/ VAD de energia."""
    n = rate * ms // 1000
    return (np.ones(n, dtype=np.int16) * amp).tobytes()


def _silencio(ms: int, rate: int = 24000) -> bytes:
    return b"\x00" * (rate * 2 * ms // 1000)


class _CbStt:
    def __init__(self):
        self.deltas: list[str] = []
        self.finais: list[str] = []
        self.ends = 0

    async def on_delta(self, d: str):
        self.deltas.append(d)

    async def on_final(self, t: str):
        self.finais.append(t)

    async def on_speech_end(self):
        self.ends += 1


class _CbTts:
    def __init__(self):
        self.audio: list[bytes] = []
        self.done = 0

    async def on_audio(self, pcm: bytes):
        self.audio.append(pcm)

    async def on_done(self):
        self.done += 1


class _FakeWhisper:
    """Duck-type de faster_whisper.WhisperModel."""

    def __init__(self, texto: str = "tudo bem por aí"):
        self.texto = texto
        self.calls: list[tuple[np.ndarray, dict]] = []

    def transcribe(self, audio, **kw):
        self.calls.append((audio, kw))
        return [SimpleNamespace(text=self.texto)], SimpleNamespace()


class _FakePiperVoz:
    """Duck-type de piper.PiperVoice — 22.05 kHz nativo."""

    def __init__(self):
        self.config = SimpleNamespace(sample_rate=22050)
        self.textos: list[str] = []

    def synthesize(self, texto, syn_config=None):
        self.textos.append(texto)
        return [SimpleNamespace(
            audio_int16_bytes=_pcm(500, amp=8000, rate=22050))]


async def _espera(cond, tentativas: int = 200) -> bool:
    for _ in range(tentativas):
        if cond():
            return True
        await asyncio.sleep(0.01)
    return False


def _stt(texto: str = "tudo bem por aí") -> tuple[WhisperLocalStt, _CbStt]:
    """STT pronto sem connect() — modelo/VAD injetados, worker vivo."""
    cb = _CbStt()
    stt = WhisperLocalStt(cb.on_delta, cb.on_final, cb.on_speech_end)
    stt._model = _FakeWhisper(texto)
    stt._vad = _VadEnergia()
    stt._worker = asyncio.create_task(stt._worker_loop())
    return stt, cb


# --------------------------------------------------------------- audio --


def test_resample_mesma_taxa_passthrough():
    pcm = _pcm(100)
    assert resample_pcm16(pcm, 24000, 24000) == pcm


def test_resample_proporcao_de_amostras():
    pcm = _pcm(1000, rate=24000)  # 24000 amostras
    out = resample_pcm16(pcm, 24000, 16000)
    assert len(out) // 2 == 16000


def test_resample_buffer_vazio():
    assert resample_pcm16(b"", 24000, 16000) == b""


def test_pcm16_para_float_normaliza_e_resamplea():
    audio = pcm16_para_float(_pcm(1000, amp=16384), de=24000, para=16000)
    assert audio.dtype == np.float32
    assert len(audio) == 16000
    assert 0.45 < float(np.abs(audio).max()) <= 0.51


# ----------------------------------------------------------------- VAD --


def test_vad_energia_distingue_fala_de_silencio():
    vad = _VadEnergia()
    for _ in range(5):
        assert not vad.is_speech(_silencio(30), 24000)
    for _ in range(5):
        assert vad.is_speech(_pcm(30), 24000)


def test_vad_webrtc_resamplea_quando_instalado():
    """Com webrtcvad instalado, frames 24k passam pelo resample p/ 16k —
    sem ele, a chamada explodiria (só aceita 8/16/32/48k)."""
    try:
        vad = _VadWebrtc()
    except Exception:
        return  # sem webrtcvad no ambiente de teste — nada a provar
    # não pode lançar — silêncio e fala devem passar pelo caminho 16k
    vad.is_speech(_silencio(30), 24000)
    vad.is_speech(_pcm(30), 24000)


# -------------------------------------------------------------- whisper --


async def test_whisper_commit_transcreve_buffer():
    stt, cb = _stt("quero um café")
    await stt.send_audio(_pcm(500))
    await stt.commit()
    assert await _espera(lambda: bool(cb.finais))
    assert cb.finais == ["quero um café"]
    assert cb.ends == 1
    await stt.close()


async def test_whisper_vad_corta_apos_silencio():
    stt, cb = _stt()
    for _ in range(14):          # 420 ms de fala (≥ mínimo de 300)
        await stt.send_audio(_pcm(30))
    for _ in range(30):          # 900 ms de silêncio (> 700)
        await stt.send_audio(_silencio(30))
    assert await _espera(lambda: bool(cb.finais))
    assert cb.finais == ["tudo bem por aí"]
    assert cb.ends == 1
    await stt.close()


async def test_whisper_fala_curta_e_descartada_sem_callback():
    stt, cb = _stt()
    for _ in range(5):           # 150 ms < mínimo de 300
        await stt.send_audio(_pcm(30))
    for _ in range(30):
        await stt.send_audio(_silencio(30))
    await asyncio.sleep(0.1)
    assert cb.finais == []
    assert cb.ends == 0          # tosse/interjeição não vira "thinking"
    await stt.close()


async def test_whisper_silencio_longo_nao_infla_buffer():
    stt, cb = _stt()
    for _ in range(80):          # 2,4 s de sala vazia
        await stt.send_audio(_silencio(30))
    await asyncio.sleep(0.05)
    # pre-roll de 300 ms + 1 frame — jamais os 2,4 s inteiros
    assert len(stt._buf) <= 24000 * 2 * 400 // 1000
    assert cb.finais == []
    await stt.close()


async def test_whisper_texto_vazio_so_emite_speech_end():
    stt, cb = _stt("   ")
    await stt.send_audio(_pcm(400))
    await stt.commit()
    assert await _espera(lambda: cb.ends == 1)
    assert cb.finais == []       # transcrição vazia não vira turno LLM
    await stt.close()


async def test_whisper_close_aborta_worker():
    stt, _ = _stt()
    await stt.close()
    assert await _espera(lambda: stt._worker.done())


# ---------------------------------------------------------------- piper --


async def test_piper_say_sintetiza_resamplea_e_chama_done():
    cb = _CbTts()
    voz = _FakePiperVoz()
    tts = PiperTts(cb.on_audio, cb.on_done, voice=voz)
    await tts.connect()
    await tts.say("Olá, **tudo** bem?")
    await tts.close()
    assert await _espera(lambda: cb.done == 1)
    assert voz.textos == ["Olá, tudo bem?"]   # markdown limpo
    pcm = b"".join(cb.audio)
    # 500 ms @22050 (11025 amostras) → 12000 amostras @24 kHz
    assert abs(len(pcm) // 2 - 12000) < 200


async def test_piper_cancel_interrompe_sem_done():
    cb = _CbTts()
    tts = PiperTts(cb.on_audio, cb.on_done, voice=_FakePiperVoz())
    await tts.connect()
    await tts.cancel()
    await asyncio.sleep(0.05)
    assert cb.done == 0


async def test_piper_sentencas_processadas_em_ordem():
    cb = _CbTts()
    voz = _FakePiperVoz()
    tts = PiperTts(cb.on_audio, cb.on_done, voice=voz)
    await tts.connect()
    await tts.say("Primeira frase.")
    await tts.say("Segunda frase.")
    await tts.close()
    assert await _espera(lambda: cb.done == 1)
    assert voz.textos == ["Primeira frase.", "Segunda frase."]
    assert len(cb.audio) == 2


# ------------------------------------------------------------- config ----


def test_validate_runtime_piper_nao_exige_elevenlabs():
    s = Settings(
        jwt_secret="x", openai_api_key="k", maria_tts_provider="piper")
    assert s.validate_runtime() == []


def test_validate_runtime_elevenlabs_exige_credenciais():
    s = Settings(
        jwt_secret="x", openai_api_key="k", maria_tts_provider="elevenlabs")
    faltando = s.validate_runtime()
    assert "ELEVENLABS_API_KEY" in faltando
    assert "ELEVENLABS_VOICE_ID" in faltando
