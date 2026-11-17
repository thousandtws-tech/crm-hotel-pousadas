//! Estado compartilhado do servidor.

use clarituz_application::Services;
use clarituz_domain::ports::{ObjectStore, TokenIssuer};
use clarituz_infrastructure::EventBus;
use sqlx::PgPool;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub services: Arc<Services>,
    pub issuer: Arc<dyn TokenIssuer>,
    /// Pool para o readiness probe (`/readyz`).
    pub pool: PgPool,
    /// Diretório de arquivos (logo, comprovantes).
    pub storage_dir: String,
    /// Armazenamento de objetos (mídia) — MinIO/S3 ou filesystem.
    pub store: Arc<dyn ObjectStore>,
    /// Barramento realtime (broadcast) — assinado pelo SSE de notificações.
    pub eventos: EventBus,
    /// Origens permitidas (env `CORS_ORIGINS`; `*` = dev aberto).
    pub cors_origins: Vec<String>,
    /// Segredo de assinatura do webhook Stripe — `None` desabilita a rota.
    pub stripe_webhook_secret: Option<String>,
    /// Segredo HMAC dos links assinados de hóspede (descadastro LGPD) —
    /// deriva do `JWT_SECRET`, sempre configurado.
    pub link_secret: String,
    /// Chave pública VAPID (base64url) exposta ao PWA —  sem push.
    pub vapid_public_b64: Option<String>,
    /// URL pública do site — base do link/QR do motor de reservas.
    pub site_base: String,
    /// Webhook de alertas 5xx (`ALERT_WEBHOOK_URL`) — `None` = o layer
    /// de alerta nem é instalado (custo zero por request).
    pub alert_webhook_url: Option<String>,
    /// Teto de tentativas de login por IP/min (`LOGIN_RATE_LIMIT_PER_MIN`).
    pub login_rate_limit_per_min: u32,
}
