//! Configuração centralizada da aplicação (12-factor: tudo via ambiente).

use std::env;
use thiserror::Error;

/// Fuso horário de negócio — herança do legado PHP (`America/Sao_Paulo`).
pub const BUSINESS_TZ: &str = "America/Sao_Paulo";

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("variável de ambiente obrigatória ausente: {0}")]
    Missing(&'static str),
    #[error("variável {0} com valor inválido: {1}")]
    Invalid(&'static str, String),
}

/// Configuração imutável carregada uma vez no bootstrap.
#[derive(Debug, Clone)]
pub struct Settings {
    /// Bind do servidor HTTP, ex.: `0.0.0.0:8080`.
    pub http_addr: String,
    /// URL de conexão PostgreSQL.
    pub database_url: String,
    /// Tamanho máximo do pool de conexões.
    pub db_max_connections: u32,
    /// Segredo HMAC para assinatura de JWT (mínimo 32 bytes).
    pub jwt_secret: String,
    /// TTL do access token em segundos.
    pub jwt_ttl_secs: i64,
    /// TTL do refresh token em segundos.
    pub refresh_ttl_secs: i64,
    /// Origens permitidas para CORS (vírgula-separadas ou `*`).
    pub cors_origins: Vec<String>,
    /// Filtro do tracing, ex.: `info,clarituz=debug,sqlx=warn`.
    pub log_filter: String,
    /// Diretório para comprovantes gerados.
    pub storage_dir: String,
    /// Endpoint S3/MinIO — quando presente (com bucket+chaves) o object
    /// store de mídias usa S3 em vez do filesystem.
    pub s3_endpoint: Option<String>,
    /// Bucket S3 das mídias (fotos, vídeos, scans, logo).
    pub s3_bucket: Option<String>,
    /// Access key do service account MinIO/S3.
    pub s3_access_key: Option<String>,
    /// Secret key do service account MinIO/S3.
    pub s3_secret_key: Option<String>,
    /// Região de assinatura SigV4 (MinIO aceita `us-east-1`).
    pub s3_region: String,
    /// Chave secreta Stripe (`sk_test_…`/`sk_live_…`) — ausente desabilita
    /// pagamentos online com erro explícito, nunca silencioso.
    pub stripe_secret_key: Option<String>,
    /// Segredo de assinatura do webhook (`whsec_…`).
    pub stripe_webhook_secret: Option<String>,
    /// URL de retorno pós-pagamento aprovado (site público).
    pub stripe_success_url: String,
    /// URL de retorno quando o hóspede abandona/cancela.
    pub stripe_cancel_url: String,
    /// Percentual do sinal (0–100) cobrado quando o hóspede escolhe sinal.
    pub sinal_percentual: u32,
    /// Minutos que a acomodação fica bloqueada aguardando pagamento.
    pub hold_minutos: i64,
    /// Resend — sem chave, o canal e-mail falha controlado na fila.
    pub resend_api_key: Option<String>,
    /// Remetente verificado — ex.: "Pousada <reservas@dominio>".
    pub email_remetente: String,
    /// Meta Cloud API — token de acesso permanente + Phone Number ID.
    pub whatsapp_token: Option<String>,
    pub whatsapp_phone_id: Option<String>,
    /// VAPID — PEM da chave privada P-256 + pública base64url pro PWA.
    pub vapid_private_pem: Option<String>,
    pub vapid_public_b64: Option<String>,
    /// Contato do operador no JWT VAPID (`mailto:` ou https).
    pub vapid_contato: String,
    /// Base pública dos links de hóspede (ficha, avaliação, checkout).
    pub site_base: String,
    /// Nome exibido nas mensagens ao hóspede.
    pub pousada_nome: String,
}

impl Settings {
    /// Carrega `.env` (se existir) e resolve todas as variáveis com defaults seguros.
    pub fn load() -> Result<Self, ConfigError> {
        let _ = dotenvy::dotenv();

        let jwt_secret = env_string("JWT_SECRET").unwrap_or_default();
        if jwt_secret.len() < 32 {
            return Err(ConfigError::Invalid(
                "JWT_SECRET",
                "mínimo de 32 caracteres exigido".into(),
            ));
        }

        Ok(Self {
            http_addr: env_string("HTTP_ADDR")
                .or_else(|| env_string("PORT").map(|p| format!("0.0.0.0:{p}")))
                .unwrap_or_else(|| "0.0.0.0:8080".into()),
            database_url: env_string("DATABASE_URL").ok_or(ConfigError::Missing("DATABASE_URL"))?,
            db_max_connections: env_u32("DB_MAX_CONNECTIONS").unwrap_or(10),
            jwt_secret,
            jwt_ttl_secs: env_i64("JWT_TTL_SECS").unwrap_or(3600),
            refresh_ttl_secs: env_i64("REFRESH_TTL_SECS").unwrap_or(60 * 60 * 24 * 30),
            cors_origins: env_string("CORS_ORIGINS").map_or_else(
                || vec!["*".into()],
                |v| {
                    v.split(',')
                        .map(str::trim)
                        .filter(|s| !s.is_empty())
                        .map(String::from)
                        .collect()
                },
            ),
            log_filter: env_string("RUST_LOG")
                .unwrap_or_else(|| "info,tower_http=debug,sqlx=warn".into()),
            storage_dir: env_string("STORAGE_DIR").unwrap_or_else(|| "./storage".into()),
            s3_endpoint: env_string("S3_ENDPOINT"),
            s3_bucket: env_string("S3_BUCKET"),
            s3_access_key: env_string("S3_ACCESS_KEY"),
            s3_secret_key: env_string("S3_SECRET_KEY"),
            s3_region: env_string("S3_REGION").unwrap_or_else(|| "us-east-1".into()),
            stripe_secret_key: env_string("STRIPE_SECRET_KEY"),
            stripe_webhook_secret: env_string("STRIPE_WEBHOOK_SECRET"),
            stripe_success_url: env_string("STRIPE_SUCCESS_URL")
                .unwrap_or_else(|| "https://espiritodomar.com.br/reserva/pagamento/sucesso".into()),
            stripe_cancel_url: env_string("STRIPE_CANCEL_URL").unwrap_or_else(|| {
                "https://espiritodomar.com.br/reserva/pagamento/cancelado".into()
            }),
            sinal_percentual: env_u32("SINAL_PERCENTUAL").unwrap_or(30).min(100),
            hold_minutos: env_i64("HOLD_MINUTOS").unwrap_or(30).clamp(30, 1440),
            resend_api_key: env_string("RESEND_API_KEY"),
            email_remetente: env_string("EMAIL_REMETENTE").unwrap_or_else(|| {
                "Pousada Espírito do Mar <reservas@espiritodomar.com.br>".into()
            }),
            whatsapp_token: env_string("WHATSAPP_TOKEN"),
            whatsapp_phone_id: env_string("WHATSAPP_PHONE_ID"),
            vapid_private_pem: env_string("VAPID_PRIVATE_PEM"),
            vapid_public_b64: env_string("VAPID_PUBLIC_B64"),
            vapid_contato: env_string("VAPID_CONTATO")
                .unwrap_or_else(|| "mailto:contato@espiritodomar.com.br".into()),
            site_base: env_string("SITE_BASE")
                .unwrap_or_else(|| "https://espiritodomar.com.br".into()),
            pousada_nome: env_string("POUSADA_NOME")
                .unwrap_or_else(|| "Pousada Espírito do Mar".into()),
        })
    }
}

fn env_string(key: &'static str) -> Option<String> {
    env::var(key).ok().filter(|v| !v.trim().is_empty())
}

fn env_u32(key: &'static str) -> Option<u32> {
    env_string(key).and_then(|v| v.parse().ok())
}

fn env_i64(key: &'static str) -> Option<i64> {
    env_string(key).and_then(|v| v.parse().ok())
}
