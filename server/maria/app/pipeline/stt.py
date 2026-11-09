"""STT em streaming — OpenAI Realtime API (sessão de transcrição).

Conecta em wss://api.openai.com/v1/realtime com `intent=transcription`,
envia PCM16 24 kHz e recebe deltas + transcrição final por turno.

VAD: quando OPENAI_SERVER_VAD=true, configura `turn_detection` server-side
e a API emite o fim de fala sozinha. Quando false, o frontend sinaliza
`commit` — este cliente apenas faz `input_audio_buffer.commit`.
"""
import asyncio
import base64
import json
import logging
from collections.abc import Awaitable, Callable

import websockets

from ..config import get_settings
from ..infra.resilience import breaker

log = logging.getLogger("maria.stt")

OnDelta = Callable[[str], Awaitable[None]]
OnFinal = Callable[[str], Awaitable[None]]
OnSpeechEnd = Callable[[], Awaitable[None]]


class OpenAiStt:
    """Sessão de transcrição — uma conexão por sessão MAR IA."""

    def __init__(
        self,
        on_delta: OnDelta,
        on_final: OnFinal,
        on_speech_end: OnSpeechEnd,
    ):
        self.on_delta = on_delta
        self.on_final = on_final
        self.on_speech_end = on_speech_end
        self.ws = None
        self._recv_task: asyncio.Task | None = None
        self._closed = False

    async def connect(self) -> None:
        s = get_settings()
        # GA Realtime: sessão realtime normal; a transcrição entra como efeito
        # colateral via audio.input.transcription.model.
        # (O shape beta `?intent=transcription` retorna beta_api_shape_disabled.)
        url = f"wss://api.openai.com/v1/realtime?model={s.openai_realtime_model}"
        # circuito aberto → falha na hora (sessão avisa "indisponível")
        with breaker("openai-stt").vigiar():
            self.ws = await websockets.connect(
                url,
                additional_headers={"Authorization": f"Bearer {s.openai_api_key}"},
                ping_interval=20,
                ping_timeout=20,
                max_size=8 * 1024 * 1024,
                open_timeout=15,
            )

        turn_detection = (
            {
                "type": "server_vad",
                "threshold": s.openai_vad_threshold,
                "prefix_padding_ms": s.openai_vad_prefix_ms,
                "silence_duration_ms": s.openai_vad_silence_ms,
            }
            if s.openai_server_vad
            else None
        )
        session = {
            "type": "session.update",
            "session": {
                "type": "realtime",
                "audio": {
                    "input": {
                        "format": {"type": "audio/pcm", "rate": 24000},
                        "transcription": {
                            "model": s.openai_transcription_model,
                            "language": "pt",
                        },
                        "turn_detection": turn_detection,
                        **(
                            {"noise_reduction": {"type": s.openai_noise_reduction}}
                            if s.openai_noise_reduction != "off"
                            else {}
                        ),
                    },
                },
            },
        }

        await self.ws.send(json.dumps(session))
        self._recv_task = asyncio.create_task(self._recv_loop())

    async def send_audio(self, pcm: bytes) -> None:
        if not self.ws or self._closed:
            return
        await self.ws.send(
            json.dumps(
                {
                    "type": "input_audio_buffer.append",
                    "audio": base64.b64encode(pcm).decode(),
                }
            )
        )

    async def commit(self) -> None:
        """Fim de fala manual (fallback quando VAD server-side está off)."""
        if self.ws and not self._closed:
            await self.ws.send(json.dumps({"type": "input_audio_buffer.commit"}))

    async def close(self) -> None:
        self._closed = True
        if self._recv_task:
            self._recv_task.cancel()
        if self.ws:
            try:
                await self.ws.close()
            except Exception:
                pass

    async def _recv_loop(self) -> None:
        assert self.ws is not None
        try:
            async for raw in self.ws:
                try:
                    ev = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                t = ev.get("type", "")

                if t.endswith("input_audio_transcription.delta") or t.endswith(
                    "transcription.delta"
                ):
                    delta = ev.get("delta") or ""
                    if delta:
                        await self.on_delta(delta)

                elif t.endswith("input_audio_transcription.completed") or t.endswith(
                    "transcription.completed"
                ):
                    text = (ev.get("transcript") or "").strip()
                    if text:
                        await self.on_final(text)
                    await self.on_speech_end()

                elif t == "input_audio_buffer.speech_stopped":
                    # VAD server-side detectou fim de fala — sinal de turno.
                    await self.on_speech_end()

                elif t == "error":
                    log.warning("stt erro: %s", ev)
        except asyncio.CancelledError:
            raise
        except websockets.ConnectionClosed as exc:
            # queda mid-stream é sinal do provedor — conta no breaker
            breaker("openai-stt").falha(exc)
            log.info("stt conexão encerrada")
        except Exception as exc:
            breaker("openai-stt").falha(exc)
            log.exception("stt falhou")
