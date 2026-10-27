"""Configuração via variáveis de ambiente (pydantic-settings)."""
from functools import lru_cache
from zoneinfo import ZoneInfo

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # API do sistema (backend Rust)
    api_base: str = "http://localhost:8080/api/v1"

    # Mesmo JWT_SECRET do backend — valida o token do usuário
    jwt_secret: str = ""
    jwt_issuer: str = "clarituz-api"

    # OpenAI
    openai_api_key: str = ""
    openai_llm_model: str = "gpt-5.2"
    # Modelo da sessão realtime (vai na query ?model=) — versão GA.
    openai_realtime_model: str = "gpt-realtime-mini"
    # Modelo de transcrição (vai em audio.input.transcription.model)
    openai_transcription_model: str = "gpt-4o-transcribe"
    openai_server_vad: bool = True
    # Redução de ruído da Realtime: near_field (mic perto) | far_field | off
    openai_noise_reduction: str = "near_field"

    # ElevenLabs
    elevenlabs_api_key: str = ""
    elevenlabs_voice_id: str = ""
    elevenlabs_model_id: str = "eleven_turbo_v2_5"
    elevenlabs_speed: float = 1.0
    # Naturalidade: estabilidade baixa + estilo = voz mais solta/expressiva
    elevenlabs_stability: float = 0.35
    elevenlabs_similarity: float = 0.75
    elevenlabs_style: float = 0.4

    # MAR IA
    maria_voice_enabled: bool = True
    maria_default_language: str = "pt-BR"
    maria_history_enabled: bool = True
    maria_history_max_turns: int = 12
    maria_timezone: str = "America/Sao_Paulo"
    # Memória persistente (aprendizado no dia a dia)
    maria_memory_enabled: bool = True
    maria_memory_file: str = "data/memories.json"
    maria_memory_max_contexto: int = 12

    # Servidor
    maria_host: str = "0.0.0.0"
    maria_port: int = 8090

    @property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.maria_timezone)

    def validate_runtime(self) -> list[str]:
        """Retorna pendências de configuração (usado no /healthz e boot)."""
        faltando = []
        if not self.jwt_secret:
            faltando.append("JWT_SECRET")
        if not self.openai_api_key:
            faltando.append("OPENAI_API_KEY")
        if self.maria_voice_enabled and not self.elevenlabs_api_key:
            faltando.append("ELEVENLABS_API_KEY")
        if self.maria_voice_enabled and not self.elevenlabs_voice_id:
            faltando.append("ELEVENLABS_VOICE_ID")
        return faltando


@lru_cache
def get_settings() -> Settings:
    return Settings()
