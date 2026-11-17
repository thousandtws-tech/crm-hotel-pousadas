"""Configuração via variáveis de ambiente (pydantic-settings)."""
from functools import lru_cache
from zoneinfo import ZoneInfo

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # API do sistema (backend Rust)
    api_base: str = "http://localhost:8080/api/v1"
    # Chave compartilhada api↔maria p/ endpoints internos (concierge do
    # hóspede). O token público da reserva nunca chega aqui — só contexto.
    inna_internal_key: str = ""

    # Mesmo JWT_SECRET do backend — valida o token do usuário
    jwt_secret: str = ""
    jwt_issuer: str = "clarituz-api"

    # OpenAI — Inná (concierge do hóspede, resposta de avaliação) e a
    # tool get_inteligencia; a conversa da MARIA roda no ElevenLabs.
    openai_api_key: str = ""
    # timeout/retry do SDK — default do client é 10min, longo demais
    # para um turno de assistente
    openai_timeout_secs: float = 45.0
    openai_max_retries: int = 2
    openai_llm_model: str = "gpt-5.2"
    openai_embed_model: str = "text-embedding-3-small"
    # Fine-tuning — snapshot do modelo base para os jobs (finetune/).
    openai_ft_base_model: str = "gpt-4o-mini-2024-07-18"

    # ElevenLabs Agents — a MARIA é um agente publicado na plataforma;
    # o serviço só emite signed_url de sessão (a chave nunca sai do
    # backend) e serve as tools via /mcp.
    elevenlabs_api_key: str = ""
    elevenlabs_agent_id: str = ""

    # MAR IA — comportamento das tools e memória
    maria_default_language: str = "pt-BR"
    # Cache de leituras na sessão: a mesma pergunta repetida (mesma tool +
    # mesmos args) reutiliza o resultado por N segundos — menos latência e
    # menos chamadas à API. Qualquer escrita/alteração invalida tudo.
    maria_tool_cache_enabled: bool = True
    maria_tool_cache_ttl_secs: float = 45.0
    maria_timezone: str = "America/Sao_Paulo"
    # Memória persistente (aprendizado no dia a dia)
    maria_memory_file: str = "data/memories.json"

    # circuit breaker das dependências externas — após N falhas seguidas
    # chamadas falham na hora durante o cooldown (ver app/infra/resilience.py)
    maria_circuit_failures: int = 3
    maria_circuit_cooldown_secs: float = 60.0
    # RAG — base de conhecimento editorial (arquivos .md versionados no
    # repositório). A ferramenta buscar_conhecimento recupera trechos
    # por similaridade de embedding. Cache de vetores em data/ (runtime).
    maria_rag_enabled: bool = True
    maria_rag_dir: str = "knowledge"
    maria_rag_top_k: int = 4
    maria_rag_min_score: float = 0.25
    # Busca híbrida: vetor (embedding) + lexical (BM25) fundidos por RRF.
    # Com ela ligada, a base responde mesmo sem embeddings indexados
    # (só lexical); desligada, volta ao cosseno puro.
    maria_rag_hybrid: bool = True

    # Servidor
    maria_host: str = "0.0.0.0"
    maria_port: int = 8090
    # Origens permitidas no CORS (vírgula-separadas). "*" só em dev
    # local — em produção liste a origem do admin explicitamente.
    maria_cors_origins: str = "http://localhost:4200,http://127.0.0.1:4200"
    # Persistência: "json" (um arquivo por coleção em data/) ou
    # "sqlite" (data/maria.db — volume/múltiplas instâncias; migra os
    # JSONs legados na primeira abertura).
    maria_storage: str = "json"
    maria_sqlite_file: str = "data/maria.db"
    # Estado compartilhado entre réplicas (pendentes, cache de tools,
    # rate limit, budget). Vazio = tudo em memória de processo — uma
    # réplica só.
    redis_url: str = ""
    # Tracing OpenTelemetry (OTLP/HTTP): vazio = desligado.
    # Ex.: http://tempo:4318 — Langfuse também aceita OTLP.
    otel_endpoint: str = ""
    otel_service_name: str = "maria-ia"
    # Backup do data/ para S3-compatível (AWS S3 ou MinIO — endpoint
    # preenchido = MinIO/self-hosted; vazio = AWS).
    maria_backup_enabled: bool = False
    maria_backup_interval_h: float = 24.0
    maria_backup_retain: int = 14       # backups datados mantidos
    maria_s3_endpoint: str = ""         # ex.: http://localhost:9000 (MinIO)
    maria_s3_bucket: str = ""
    maria_s3_prefix: str = "maria"
    maria_s3_region: str = "us-east-1"
    maria_s3_access_key: str = ""
    maria_s3_secret_key: str = ""
    # Backup do Postgres → S3 (pg_dump custom + gzip, ver
    # app/infra/pg_backup.py). Env NOVA, separada do DATABASE_URL da
    # API — a MAR IA não abre conexão com o banco, só roda o binário
    # num subprocesso. Vazio = task nem inicia (env-gate). Reaproveita
    # bucket/credenciais/intervalo/retenção do backup do data/ acima.
    # Destino: s3://BUCKET/backups/pg/maria-pg-<AAAAMMDD-HHMMSS>.dump.gz
    backup_database_url: str = ""

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.maria_cors_origins.split(",")
                if o.strip()]

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
        if not self.elevenlabs_api_key:
            faltando.append("ELEVENLABS_API_KEY")
        if not self.elevenlabs_agent_id:
            faltando.append("ELEVENLABS_AGENT_ID")
        return faltando


@lru_cache
def get_settings() -> Settings:
    return Settings()
