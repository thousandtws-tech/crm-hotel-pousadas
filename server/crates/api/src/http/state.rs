use clarituz_application::Services;
use clarituz_domain::ports::{ObjectStore, TokenIssuer};
use clarituz_infrastructure::EventBus;
use sqlx::PgPool;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub services: Arc<Services>,

    pub issuer: Arc<dyn TokenIssuer>,

    pub pool: PgPool,

    pub storage_dir: String,

    pub store: Arc<dyn ObjectStore>,
    pub eventos: EventBus,
    pub cors_origins: Vec<String>,
    pub stripe_webhook_secret: Option<String>,
    pub link_secret: String,
    pub vapid_public_b64: Option<String>,
    pub site_base: String,
    pub api_base: Option<String>,
    pub alert_webhook_url: Option<String>,
    pub login_rate_limit_per_min: u32,
}
