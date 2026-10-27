"""Sessão MAR IA — orquestra o pipeline por conexão WebSocket.

Estados: idle → listening → thinking → speaking → listening

Fluxo de uma fala:
  áudio (binário) → STT → transcript.final → LLM (Responses API)
    → deltas de texto → SentenceBuffer → ElevenLabs TTS
    → chunks PCM (binário) → frontend toca.

Barge-in: `interrupt` cancela LLM + TTS e limpa o áudio no cliente.
Escrita real só acontece via ação preparada + confirmação.
"""
import asyncio
import json
import logging
import uuid

from fastapi import WebSocket

from .api_client import PousadaApi
from .auth import Ator
from .config import get_settings
from .llm import Orquestrador
from .metrics import Latencia
from .prompts import SAUDACAO_PADRAO
from .sentences import SentenceBuffer
from .stt import OpenAiStt
from .tts import ElevenTts

log = logging.getLogger("maria.session")


class MariaSession:
    def __init__(self, ws: WebSocket, ator: Ator, token: str):
        self.ws = ws
        self.ator = ator
        self.api = PousadaApi(token)
        self.llm = Orquestrador(self.api, ator)
        self.stt: OpenAiStt | None = None
        self.tts: ElevenTts | None = None
        self.lat = Latencia()
        self._turno = uuid.uuid4().hex
        self._task: asyncio.Task | None = None
        self._lock = asyncio.Lock()

    # ---------------------------------------------------------- envio --
    async def _send(self, ev: dict) -> None:
        try:
            await self.ws.send_text(json.dumps(ev, ensure_ascii=False))
        except Exception:
            pass

    async def _audio(self, pcm: bytes) -> None:
        try:
            await self.ws.send_bytes(pcm)
        except Exception:
            pass

    async def _estado(self, estado: str) -> None:
        await self._send({"type": "state", "state": estado})

    # -------------------------------------------------------- startup --
    async def iniciar(self) -> None:
        s = get_settings()
        await self._send(
            {
                "type": "hello",
                "nome": self.ator.nome,
                "nivel": self.ator.nivel,
                "voz": s.maria_voice_enabled and bool(s.elevenlabs_api_key),
                # mic (STT) independe do TTS — fala→texto funciona sem ElevenLabs
                "mic": bool(s.openai_api_key),
                "vad": s.openai_server_vad,
            }
        )
        if s.openai_api_key:
            self.stt = OpenAiStt(
                on_delta=self._stt_delta,
                on_final=self._stt_final,
                on_speech_end=self._speech_end,
            )
            try:
                await self.stt.connect()
            except Exception:
                log.exception("falha ao conectar STT")
                await self._send(
                    {"type": "error", "code": "stt", "message": "Transcrição indisponível."}
                )
                self.stt = None

    async def encerrar(self) -> None:
        await self._cancelar_turno()
        if self.stt:
            await self.stt.close()
        await self.api.close()

    # ---------------------------------------------------- mensagens ---
    async def on_audio(self, pcm: bytes) -> None:
        if self.stt:
            self.lat.mark("fala_ini")
            await self.stt.send_audio(pcm)

    async def on_control(self, msg: dict) -> None:
        t = msg.get("type")
        if t == "ping":
            await self._send({"type": "pong"})
        elif t == "commit" and self.stt:
            await self.stt.commit()
        elif t == "interrupt":
            await self._cancelar_turno()
            await self._estado("listening")
        elif t == "text":
            texto = (msg.get("text") or "").strip()
            if texto:
                tela = (msg.get("tela") or "").strip()
                if tela:
                    texto = f"[tela: {tela}] {texto}"
                await self._turno_llm(texto, origem="texto")
        elif t == "confirm":
            # Confirmação explícita por botão da interface — executa a
            # ação preparada e avisa o LLM para anunciar o resultado.
            await self._confirmar_ui(msg.get("idacao") or "")
        elif t == "saida" or t == "reset":
            await self._cancelar_turno()
            await self._estado("idle")

    # -------------------------------------------------- STT callbacks --
    async def _stt_delta(self, delta: str) -> None:
        await self._send({"type": "transcript", "text": delta, "final": False})

    async def _stt_final(self, text: str) -> None:
        self.lat.desde("fala_ini", "stt_final")
        await self._send({"type": "transcript", "text": text, "final": True})
        await self._turno_llm(text, origem="voz")

    async def _speech_end(self) -> None:
        await self._estado("thinking")

    async def _tts_say(self, texto: str) -> None:
        """Falha de TTS não derruba o turno — degrada para só-texto."""
        if not self.tts:
            return
        try:
            await self.tts.say(texto)
        except Exception:
            log.exception("tts falhou no envio — segue só texto")
            self.tts = None
            await self._send(
                {
                    "type": "error",
                    "code": "tts",
                    "message": "Voz indisponível — seguindo em texto.",
                }
            )

    # -------------------------------------------------- turno do LLM --
    async def _turno_llm(self, texto: str, origem: str) -> None:
        async with self._lock:
            self._turno = uuid.uuid4().hex
            await self._estado("thinking")
            buf = SentenceBuffer()
            primeiro_token = False
            primeiro_audio = False

            async def on_text(delta: str) -> None:
                nonlocal primeiro_token
                if not primeiro_token:
                    primeiro_token = True
                    self.lat.desde("fala_ini", "llm_primeiro_token")
                await self._send({"type": "assistant_delta", "text": delta})
                if self.tts:
                    for s in buf.push(delta):
                        await self._tts_say(s)

            async def on_tool(nome: str) -> None:
                await self._send({"type": "tool", "name": nome})

            async def on_tool_result(nome: str, resultado: dict) -> None:
                if resultado.get("status") == "preparada":
                    await self._send(
                        {
                            "type": "action_required",
                            "idacao": resultado.get("idacao"),
                            "acao": resultado.get("acao"),
                            "resumo": resultado.get("resumo"),
                        }
                    )
                if resultado.get("navegar"):
                    await self._send(
                        {"type": "nav", "rota": resultado["navegar"]}
                    )

            async def on_audio(pcm: bytes) -> None:
                nonlocal primeiro_audio
                if not primeiro_audio:
                    primeiro_audio = True
                    self.lat.desde("fala_ini", "tts_primeiro_audio")
                    self.lat.desde("fala_ini", "resposta_total")
                await self._audio(pcm)

            async def on_tts_done() -> None:
                await self._estado("listening")

            # voz habilitada? cria o canal ElevenLabs desta resposta
            s = get_settings()
            if s.maria_voice_enabled and s.elevenlabs_api_key and s.elevenlabs_voice_id:
                self.tts = ElevenTts(on_audio=on_audio, on_done=on_tts_done)
                try:
                    await self.tts.connect()
                except Exception:
                    log.exception("falha ao conectar ElevenLabs")
                    self.tts = None
                    await self._send(
                        {"type": "error", "code": "tts", "message": "Voz indisponível."}
                    )

            try:
                resultado = await self.llm.responder(
                    texto, on_text, on_tool, on_tool_result
                )
                # última sentença → TTS; fecha o canal
                if self.tts:
                    resto = buf.flush()
                    if resto:
                        await self._tts_say(resto)
                    if self.tts:
                        await self.tts.close()
                        self.tts = None
                await self._send({"type": "assistant_done", "text": resultado.texto})
                if not self.tts:
                    await self._estado("listening")
            except asyncio.CancelledError:
                raise
            except Exception as e:
                log.exception("falha no turno LLM")
                if self.tts:
                    await self.tts.cancel()
                    self.tts = None
                await self._send(
                    {"type": "error", "code": "llm", "message": "Não consegui processar agora."}
                )
                await self._estado("listening")

    async def _confirmar_ui(self, idacao: str) -> None:
        """Botão de confirmação da interface — executa a ação e devolve
        o resultado ao LLM para anunciar verbalmente."""
        pend = self.llm.tools.pendente(idacao)
        resultado = await self.llm.tools.run("confirmar_acao", {"idacao": idacao})
        await self._send(
            {
                "type": "action_done",
                "idacao": idacao,
                "ok": resultado.get("status") == "executada",
                "mensagem": resultado.get("mensagem"),
            }
        )
        # injeta no contexto para o assistente anunciar o número real
        nota = (
            f"[sistema] Ação '{pend['acao'] if pend else idacao}' confirmada "
            f"pelo usuário na interface. Resultado real: {resultado}. "
            "Anuncie o resultado em uma frase."
        )
        await self._turno_llm(nota, origem="sistema")

    async def _cancelar_turno(self) -> None:
        self.llm.cancelar()
        if self.tts:
            await self.tts.cancel()
            self.tts = None
        await self._send({"type": "audio.clear"})

    # ------------------------------------------------------ saudação --
    async def saudar(self) -> None:
        """Fala a saudação inicial (opcional, ao conectar)."""
        await self._send({"type": "assistant_done", "text": SAUDACAO_PADRAO})
        s = get_settings()
        if s.maria_voice_enabled and s.elevenlabs_api_key:
            async def on_audio(pcm: bytes) -> None:
                await self._audio(pcm)

            async def on_done() -> None:
                await self._estado("idle")

            tts = ElevenTts(on_audio=on_audio, on_done=on_done)
            try:
                await tts.connect()
                await tts.say(SAUDACAO_PADRAO)
                await tts.close()
            except Exception:
                log.exception("saudação TTS falhou")
