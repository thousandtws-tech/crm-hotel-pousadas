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
}
