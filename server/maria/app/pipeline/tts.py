"""TTS em streaming — ElevenLabs WebSocket (stream-input).

Pipeline: recebe sentenças → envia com `try_trigger_generation` →
recebe chunks de áudio PCM → repassa ao frontend. `close()` sinaliza fim
de texto; `cancel()` aborta (barge-in do usuário).
"""
import asyncio
import base64
import json
import logging
import re
from collections.abc import Awaitable, Callable
from pathlib import Path

import websockets

from ..config import get_settings
from ..infra.resilience import breaker
from .audio import resample_pcm16

log = logging.getLogger("maria.tts")

_LINK = re.compile(r"\[([^\]]+)\]\([^)]*\)")
_MARK = re.compile(r"[*_`#>~]")
_LISTA = re.compile(r"(?m)^\s*[-•+*]\s+")
_LISTANUM = re.compile(r"(?m)^\s*\d+[.)]\s+")
_ESPACO = re.compile(r"[ \t]{2,}")


def _fala_limpa(t: str) -> str:
    t = _LINK.sub(r"\1", t)
    t = _MARK.sub("", t)
    t = _LISTA.sub("", t)
    t = _LISTANUM.sub("", t)
    t = _ESPACO.sub(" ", t)
    return t.strip()

OnAudio = Callable[[bytes], Awaitable[None]]
OnDone = Callable[[], Awaitable[None]]


class ElevenTts:
    """Uma conexão por resposta do assistente."""

    def __init__(self, on_audio: OnAudio, on_done: OnDone):
        self.on_audio = on_audio
        self.on_done = on_done
        self.ws = None
        self._recv: asyncio.Task | None = None
        self._closed = False
        self._text_sent = False

    async def connect(self) -> None:
        s = get_settings()
        url = (
            "wss://api.elevenlabs.io/v1/text-to-speech/"
            f"{s.elevenlabs_voice_id}/stream-input"
            f"?model_id={s.elevenlabs_model_id}&output_format=pcm_24000"
            "&inactivity_timeout=180"
        )
        with breaker("elevenlabs-tts").vigiar():
            self.ws = await websockets.connect(
                url, ping_interval=20, ping_timeout=30, open_timeout=15
            )
        await self.ws.send(
            json.dumps(
                {
                    "text": " ",
                    "voice_settings": {
                        "speed": s.elevenlabs_speed,
                        "stability": s.elevenlabs_stability,
                        "similarity_boost": s.elevenlabs_similarity,
                        "style": s.elevenlabs_style,
                        "use_speaker_boost": True,
                    },
                    "inactivity_timeout": 180,
                    "xi_api_key": s.elevenlabs_api_key,
                }
            )
        )
        self._recv = asyncio.create_task(self._recv_loop())

    async def say(self, sentence: str) -> None:
        """Enfileira um segmento de texto para síntese incremental."""
        sentence = _fala_limpa(sentence)
        if not self.ws or self._closed or not sentence:
            return
        self._text_sent = True
        await self.ws.send(
            json.dumps(
                {
                    "text": sentence + " ",
                    "try_trigger_generation": True,
                }
            )
        )

    async def close(self) -> None:
        """Sinaliza fim do texto — a API emite flush + últimos chunks."""
        if not self.ws or self._closed:
            return
        if not self._text_sent:
            await self._finish()
            return
        try:
            await self.ws.send(json.dumps({"text": "", "flush": True}))
        except websockets.ConnectionClosed:
            pass

    async def cancel(self) -> None:
        self._closed = True
        self._stop_tasks()
        if self.ws:
            try:
                await self.ws.close()
            except Exception:
                pass

    def _stop_tasks(self) -> None:
        if self._recv:
            self._recv.cancel()

    async def _finish(self) -> None:
        self._closed = True
        self._stop_tasks()
        if self.ws:
            try:
                await self.ws.close()
            except Exception:
                pass
        await self.on_done()

    async def _recv_loop(self) -> None:
        assert self.ws is not None
        try:
            async for raw in self.ws:
                try:
                    ev = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if ev.get("audio"):
                    await self.on_audio(base64.b64decode(ev["audio"]))
                if ev.get("isFinal") or ev.get("is_final"):
                    await self._finish()
                    return
                if ev.get("error"):
                    log.warning("tts erro: %s", ev)
        except asyncio.CancelledError:
            raise
        except websockets.ConnectionClosed as exc:
            if not self._closed:
                breaker("elevenlabs-tts").falha(exc)
                await self.on_done()
        except Exception as exc:
            breaker("elevenlabs-tts").falha(exc)
            log.exception("tts falhou")
            if not self._closed:
                await self.on_done()


# ------------------------------------------------------------------
# TTS local — Piper (provider "piper")
# ------------------------------------------------------------------

class PiperTts:
    """TTS local via piper-tts — vozes ONNX pt-BR, zero custo por char.

    Mesmo contrato do ElevenTts: say() enfileira sentenças, um worker
    sequencial sintetiza em thread (ONNX bloqueia a CPU — nunca no
    event loop) e emite on_audio(pcm 24k). close() drena a fila e
    dispara on_done; cancel() aborta no meio.

    A voz baixa uma vez de HuggingFace p/ piper_dir (volume persiste).
    Modelos carregados ficam em cache de processo — o TTS é instanciado
    por resposta e reabrir a sessão ONNX a cada turno custaria 100s de ms.
    """

    _OUT_RATE = 24000
    _VOZES: dict[str, object] = {}   # PiperVoice por nome — singleton

    def __init__(self, on_audio: OnAudio, on_done: OnDone, voice=None):
        self.on_audio = on_audio
        self.on_done = on_done
        self._voice = voice           # injeção p/ testes
        self._rate = 22050            # atualizada ao carregar a voz
        self._fila: asyncio.Queue[str | None] | None = None
        self._worker: asyncio.Task | None = None
        self._closed = False
        self._cancelado = False

    async def connect(self) -> None:
        s = get_settings()
        if self._voice is None:
            self._voice = self._VOZES.get(s.piper_voice)
        if self._voice is None:
            try:
                from piper import PiperVoice
                from piper.download_voices import download_voice
            except ImportError as exc:
                raise RuntimeError(
                    "provider piper exige piper-tts no requirements"
                ) from exc
            pasta = Path(s.piper_dir)
            loop = asyncio.get_running_loop()

            def _baixa() -> None:
                pasta.mkdir(parents=True, exist_ok=True)
                download_voice(s.piper_voice, pasta)

            await loop.run_in_executor(None, _baixa)
            self._voice = await loop.run_in_executor(
                None, lambda: PiperVoice.load(
                    str(pasta / f"{s.piper_voice}.onnx")))
            self._VOZES[s.piper_voice] = self._voice
        self._rate = int(getattr(
            getattr(self._voice, "config", None), "sample_rate", 22050))
        self._fila = asyncio.Queue()
        self._worker = asyncio.create_task(self._worker_loop())
        log.info("tts piper pronto — voz=%s rate=%d", s.piper_voice,
                 self._rate)

    async def say(self, sentence: str) -> None:
        sentence = _fala_limpa(sentence)
        if self._closed or self._fila is None or not sentence:
            return
        await self._fila.put(sentence)

    async def close(self) -> None:
        """Fim do texto — drena a fila e sinaliza on_done."""
        if self._closed or self._fila is None:
            return
        self._closed = True
        await self._fila.put(None)

    async def cancel(self) -> None:
        """Barge-in — aborta síntese e fila sem chamar on_done."""
        self._closed = True
        self._cancelado = True
        if self._worker:
            self._worker.cancel()

    async def _worker_loop(self) -> None:
        assert self._fila is not None
        while True:
            frase = await self._fila.get()
            if frase is None:
                break
            try:
                pcm = await self._sintetiza(frase)
                if pcm and not self._cancelado:
                    await self.on_audio(pcm)
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("piper falhou na síntese")
        await self.on_done()

    async def _sintetiza(self, frase: str) -> bytes:
        return await asyncio.get_running_loop().run_in_executor(
            None, self._sintetiza_sync, frase)

    def _sintetiza_sync(self, frase: str) -> bytes:
        s = get_settings()
        syn = None
        if s.piper_length_scale != 1.0:
            try:
                from piper import SynthesisConfig
                syn = SynthesisConfig(length_scale=s.piper_length_scale)
            except Exception:
                syn = None
        partes = [
            c.audio_int16_bytes for c in self._voice.synthesize(frase, syn)
        ]
        return resample_pcm16(b"".join(partes), self._rate, self._OUT_RATE)
