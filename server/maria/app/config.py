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

    # OpenAI
    openai_api_key: str = ""
    # timeout/retry do SDK — default do client é 10min, longo demais
    # para um assistente de voz por turno
    openai_timeout_secs: float = 45.0
    openai_max_retries: int = 2
    openai_llm_model: str = "gpt-5.2"
    # Esforço de raciocínio da Responses API: low = TTFT bem menor
    # (ideal p/ voz). Use "none" para desativar o parâmetro.
    openai_llm_reasoning_effort: str = "low"
    # Modelo reserva do LLM — se a chamada do modelo principal falha
    # antes do primeiro token emitido, o turno é refeito neste modelo
    # (idealmente menor/mais barato, ex.: gpt-5-mini). Vazio = sem fallback.
    openai_llm_fallback_model: str = ""
    # Fallback multi-provedor — endpoint OpenAI-compatível via Chat
    # Completions (a Responses API é exclusiva da OpenAI). Cerebras
    # (wafer-scale) é ideal para voz: latência de tokens muito baixa.
    # Ativado quando cerebras_api_key + cerebras_model estão preenchidos.
    cerebras_api_key: str = ""
    cerebras_base_url: str = "https://api.cerebras.ai/v1"
    cerebras_model: str = "llama-3.3-70b"
    # Modelo da sessão realtime (vai na query ?model=) — versão GA.
    openai_realtime_model: str = "gpt-realtime-mini"
    # Modelo de transcrição (vai em audio.input.transcription.model)
    openai_transcription_model: str = "gpt-4o-transcribe"
    # Dica de vocabulário p/ a transcrição — termos do domínio aumentam
    # a precisão do STT em fala rápida e sotaques (vai em
    # audio.input.transcription.prompt).
    openai_transcription_prompt: str = (
        "Conversa em português do Brasil sobre gestão de pousada: "
        "check-in, check-out, reserva, hóspede, suíte, diária, frigobar, "
        "comanda, PDV, caixa, sangria, FNRH, café da manhã, estoque, "
        "Pousada Espírito do Mar, Maria."
    )
    openai_server_vad: bool = True
    # VAD server-side: silêncio curto = resposta mais rápida ao fim da fala.
    openai_vad_threshold: float = 0.5
    openai_vad_prefix_ms: int = 300
    openai_vad_silence_ms: int = 450
    # Redução de ruído da Realtime: near_field (mic perto) | far_field | off
    openai_noise_reduction: str = "near_field"

    # ElevenLabs
    elevenlabs_api_key: str = ""
    elevenlabs_voice_id: str = ""
    elevenlabs_model_id: str = "eleven_turbo_v2_5"
    elevenlabs_speed: float = 1.0
    # Voz limpa e consistente (estilo ChatGPT): estabilidade mediana
    # evita oscilações; estilo baixo reduz artefatos de expressividade.
    elevenlabs_stability: float = 0.5
    elevenlabs_similarity: float = 0.75
    elevenlabs_style: float = 0.2

    # MAR IA
    maria_voice_enabled: bool = True
    maria_default_language: str = "pt-BR"
    maria_history_enabled: bool = True
    maria_history_max_turns: int = 12
    # Teto de contexto: o histórico também é cortado por tamanho —
    # turnos longos (respostas com muitos dados) não estouram o orçamento
    # mesmo dentro do limite de turnos.
    maria_history_max_chars: int = 24000
    # Corte por saída de ferramenta devolvida ao modelo — listas grandes
    # (ex.: 200 reservas) não consomem a janela inteira. O resultado
    # completo segue gravado no diário de turnos (dataset).
    maria_tool_result_max_chars: int = 6000
    # Cache de leituras na sessão: a mesma pergunta repetida (mesma tool +
    # mesmos args) reutiliza o resultado por N segundos — menos latência e
    # menos chamadas à API. Qualquer escrita/alteração invalida tudo.
    maria_tool_cache_enabled: bool = True
    maria_tool_cache_ttl_secs: float = 45.0
    # Rolling summary: pares cortados do histórico são resumidos pelo LLM
    # em vez de sumirem — preserva contexto de sessões longas.
    maria_summary_enabled: bool = True
    maria_timezone: str = "America/Sao_Paulo"
    # Memória persistente (aprendizado no dia a dia)
    maria_memory_enabled: bool = True
    maria_memory_file: str = "data/memories.json"
    maria_memory_max_contexto: int = 12
    # Fillers falados ("deixa eu ver…") enquanto tools rodam — corta o
    # silêncio percebido e humaniza o turno.
    maria_filler_enabled: bool = True
    # Tools independentes na mesma rodada executam em paralelo.
    maria_parallel_tools: bool = True

    # circuit breaker das dependências externas — após N falhas seguidas
    # chamadas falham na hora durante o cooldown (ver app/infra/resilience.py)
    maria_circuit_failures: int = 3
    maria_circuit_cooldown_secs: float = 60.0
    # Diário de turnos (JSONL) — vira dataset de avaliação/treino.
    maria_transcript_enabled: bool = True
    maria_transcript_file: str = "data/turns.jsonl"
    maria_transcript_max_bytes: int = 10 * 1024 * 1024
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
    openai_embed_model: str = "text-embedding-3-small"
    # Fine-tuning — snapshot do modelo base para os jobs (finetune/).
    openai_ft_base_model: str = "gpt-4o-mini-2024-07-18"

    # Servidor
    maria_host: str = "0.0.0.0"
    maria_port: int = 8090
    # Origens permitidas no CORS (vírgula-separadas). "*" só em dev
    # local — em produção liste a origem do admin explicitamente.
    maria_cors_origins: str = "http://localhost:4200,http://127.0.0.1:4200"
    # Teto de uso por sessão — proteção de custo contra loops/abuso:
    # máximo de turnos LLM por conexão e de tokens (in+out) por turno.
    maria_limite_turnos_sessao: int = 200
    maria_limite_tokens_turno: int = 40000
    # Persistência: "json" (um arquivo por coleção em data/) ou
    # "sqlite" (data/maria.db — volume/múltiplas instâncias; migra os
    # JSONs legados na primeira abertura).
    maria_storage: str = "json"
    maria_sqlite_file: str = "data/maria.db"
    # Estado compartilhado entre réplicas (pendentes, cache de tools,
    # histórico de conversa, rate limit, budget). Vazio = tudo em
    # memória de processo — uma réplica só.
    redis_url: str = ""
    # TTL do histórico persistido por usuário (segundos). Reconexão
    # dentro da janela retoma a conversa até em outra réplica.
    maria_hist_ttl_secs: int = 4 * 3600
    # Controle de custo por usuário — 0 = desligado. Janela deslizante
    # de 1 min p/ turnos; budget soma input+output de tokens no dia.
    maria_rate_turnos_min: int = 0
    maria_budget_tokens_dia: int = 0
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
        if self.maria_voice_enabled and not self.elevenlabs_api_key:
            faltando.append("ELEVENLABS_API_KEY")
        if self.maria_voice_enabled and not self.elevenlabs_voice_id:
            faltando.append("ELEVENLABS_VOICE_ID")
        return faltando


@lru_cache
def get_settings() -> Settings:
    return Settings()
