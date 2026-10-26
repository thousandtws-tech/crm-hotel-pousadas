//! Estado compartilhado do servidor.

use clarituz_application::Services;
use clarituz_domain::ports::TokenIssuer;
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
    /// Barramento realtime (broadcast) — assinado pelo SSE de notificações.
    pub eventos: EventBus,
}
