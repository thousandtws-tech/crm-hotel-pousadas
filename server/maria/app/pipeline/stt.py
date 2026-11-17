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
from pathlib import Path

import websockets

from ..config import get_settings
from ..infra.resilience import breaker
from .audio import pcm16_para_float, resample_pcm16

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
        url = f"wss://api.openai.com/v1/realtime?model={s.openai_realtime_model}"
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
                            **(
                                {"prompt": s.openai_transcription_prompt}
                                if s.openai_transcription_prompt
                                else {}
                            ),
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
                    await self.on_speech_end()

                elif t == "error":
                    log.warning("stt erro: %s", ev)
        except asyncio.CancelledError:
            raise
        except websockets.ConnectionClosed as exc:
            breaker("openai-stt").falha(exc)
            log.info("stt conexão encerrada")
        except Exception as exc:
            breaker("openai-stt").falha(exc)
            log.exception("stt falhou")


# ------------------------------------------------------------------
# STT local — faster-whisper (provider "whisper")
# ------------------------------------------------------------------

class _VadEnergia:
    """Fallback do webrtcvad — RMS por frame com piso adaptativo.

    Menos robusto a ruído de fundo que o webrtcvad, mas funciona sem
    nenhuma dependência nativa (só numpy, já exigida pelo whisper).
    """

    def __init__(self) -> None:
        self._piso = 300.0  # começa conservador; adapta no silêncio

    def is_speech(self, frame: bytes, rate: int) -> bool:
        import numpy as np

        x = np.frombuffer(frame, dtype=np.int16).astype(np.float32)
        rms = float(np.sqrt(np.mean(x * x))) if len(x) else 0.0
        if rms < self._piso * 0.9:
            self._piso = 0.95 * self._piso + 0.05 * rms
        return rms > max(self._piso * 2.2, 400.0)


class _VadWebrtc:
    """Adapter do webrtcvad p/ a taxa da sessão.

    webrtcvad só aceita 8/16/32/48 kHz — o pipeline trabalha a 24k,
    então cada frame resamplea p/ 16k antes do is_speech (custo
    desprezível: 480→320 amostras).
    """

    def __init__(self, mode: int = 2) -> None:
        import webrtcvad

        self._v = webrtcvad.Vad(mode)

    def is_speech(self, frame: bytes, rate: int) -> bool:
        return self._v.is_speech(
            resample_pcm16(frame, rate, 16000), 16000)


def _novo_vad():
    """webrtcvad quando instalado; energia como plano B."""
    try:
        return _VadWebrtc()
    except Exception:
        return _VadEnergia()


class WhisperLocalStt:
    """STT local via faster-whisper — mesma interface do OpenAiStt.

    Diferenças honestas vs. Realtime: não emite partials (a transcrição
    sai só no fim da fala) e o fim de fala é decidido localmente — VAD
    em frames de 30 ms quando `openai_server_vad` está ligado, ou pelo
    `commit` do frontend no modo manual.

    O modelo baixa uma vez em `whisper_dir` (o volume do Railway
    persiste — não repete a cada deploy).
    """

    _FRAME_MS = 30
    _RATE = 24000
    _PRE_ROLL_MS = 300  # fala anterior p/ não clipar o início

    def __init__(
        self,
        on_delta: OnDelta,
        on_final: OnFinal,
        on_speech_end: OnSpeechEnd,
    ):
        self.on_delta = on_delta
        self.on_final = on_final
        self.on_speech_end = on_speech_end
        self._model = None
        self._vad = None
        self._buf = bytearray()
        self._vad_pos = 0
        self._falando = False
        self._fala_ms = 0
        self._silencio_ms = 0
        self._fila: asyncio.Queue[bytes | None] = asyncio.Queue()
        self._worker: asyncio.Task | None = None
        self._closed = False

    async def connect(self) -> None:
        s = get_settings()
        try:
            from faster_whisper import WhisperModel
        except ImportError as exc:
            raise RuntimeError(
                "provider whisper exige faster-whisper no requirements"
            ) from exc

        def _load():
            Path(s.whisper_dir).mkdir(parents=True, exist_ok=True)
            return WhisperModel(
                s.whisper_model,
                device="cpu",
                compute_type=s.whisper_compute,
                download_root=s.whisper_dir,
            )

        self._model = await asyncio.get_running_loop().run_in_executor(
            None, _load)
        if s.openai_server_vad:
            self._vad = _novo_vad()
            log.info("stt whisper: VAD local ativo (%s)",
                     type(self._vad).__name__)
        else:
            log.info("stt whisper: modo commit manual")
        self._worker = asyncio.create_task(self._worker_loop())
        log.info("stt whisper pronto — model=%s", s.whisper_model)

    async def send_audio(self, pcm: bytes) -> None:
        if self._closed:
            return
        self._buf.extend(pcm)
        if self._vad is not None:
            self._vad_step()

    def _vad_step(self) -> None:
        s = get_settings()
        frame_n = self._RATE * 2 * self._FRAME_MS // 1000
        while len(self._buf) - self._vad_pos >= frame_n:
            frame = bytes(self._buf[self._vad_pos:self._vad_pos + frame_n])
            self._vad_pos += frame_n
            try:
                fala = self._vad.is_speech(frame, self._RATE)
            except Exception:
                fala = True
            if fala:
                self._falando = True
                self._fala_ms += self._FRAME_MS
                self._silencio_ms = 0
            elif self._falando:
                self._silencio_ms += self._FRAME_MS
                if self._silencio_ms >= s.whisper_vad_silence_ms:
                    self._corta_fala()
                    return
            else:
                # sala silenciosa — mantém só o pre-roll p/ o buffer
                # não crescer pela sessão inteira
                limite = self._RATE * 2 * self._PRE_ROLL_MS // 1000
                excesso = len(self._buf) - limite
                if excesso > 0:
                    del self._buf[:excesso]
                    self._vad_pos = max(0, self._vad_pos - excesso)

    def _corta_fala(self) -> None:
        s = get_settings()
        if self._fala_ms >= s.whisper_vad_min_ms and self._buf:
            self._fila.put_nowait(bytes(self._buf))
        self._buf.clear()
        self._vad_pos = 0
        self._falando = False
        self._fala_ms = 0
        self._silencio_ms = 0

    async def commit(self) -> None:
        """Fim de fala manual — transcreve o buffer mesmo abaixo do
        mínimo de VAD (commit é intenção explícita do usuário)."""
        if not self._closed and self._buf:
            self._fala_ms = max(
                self._fala_ms, get_settings().whisper_vad_min_ms)
            self._corta_fala()

    async def close(self) -> None:
        """Sessão encerrando — aborta transcrições pendentes."""
        self._closed = True
        if self._worker:
            self._worker.cancel()

    async def _worker_loop(self) -> None:
        while True:
            pcm = await self._fila.get()
            if pcm is None:
                return
            await self._transcreve(pcm)

    async def _transcreve(self, pcm: bytes) -> None:
        s = get_settings()
        try:
            audio = pcm16_para_float(pcm, de=self._RATE, para=16000)
            loop = asyncio.get_running_loop()
            segmentos, _info = await loop.run_in_executor(
                None,
                lambda: self._model.transcribe(
                    audio,
                    language=s.whisper_lang,
                    beam_size=s.whisper_beam,
                    vad_filter=True,  # Silero interno corta silêncio inicial
                ),
            )
            texto = " ".join(seg.text.strip() for seg in segmentos).strip()
            if texto:
                await self.on_final(texto)
            await self.on_speech_end()
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("whisper falhou na transcrição")
            await self.on_speech_end()
