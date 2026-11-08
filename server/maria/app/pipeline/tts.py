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

import websockets

from ..config import get_settings

log = logging.getLogger("maria.tts")

# Markdown/formatação não é falável — a ElevenLabs "lê" os asteriscos
# e tropeça. Limpa cada segmento antes de sintetizar.
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
        # PCM 24 kHz casa com o pipeline do frontend
        url = (
            "wss://api.elevenlabs.io/v1/text-to-speech/"
            f"{s.elevenlabs_voice_id}/stream-input"
            f"?model_id={s.elevenlabs_model_id}&output_format=pcm_24000"
            # 180 = máx. da API — turnos com ferramentas passam de 20s
            # sem texto novo (era o input_timeout_exceeded).
            "&inactivity_timeout=180"
        )
        self.ws = await websockets.connect(url, ping_interval=20, ping_timeout=30)
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
        # Nota: sem keepalive de texto — `inactivity_timeout=180` já
        # segura a conexão em turnos longos com ferramentas, e enviar
        # " " a cada Ns criava fronteiras de geração (travava a voz).

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
        except websockets.ConnectionClosed:
            if not self._closed:
                await self.on_done()
        except Exception:
            log.exception("tts falhou")
            if not self._closed:
                await self.on_done()
