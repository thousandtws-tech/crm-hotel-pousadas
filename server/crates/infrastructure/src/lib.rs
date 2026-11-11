//! `clarituz-infrastructure` — adapters concretos dos ports do domínio,
//! organizados por responsabilidade técnica:
//!
//! - `composition`  — composition root (fiação do grafo de dependências)
//! - `persistence`  — pool PostgreSQL, migrations e repositories (sqlx)
//! - `security`     — Argon2id (hash de senha) e JWT (emissor de tokens)
//! - `messaging`    — barramento interno de eventos + relay `LISTEN/NOTIFY`
//! - `storage`      — object store (S3/MinIO/filesystem) e probe de diagnóstico
//! - `integrations` — gateways externos (Stripe, Maria/IA, emissores de envio)
//! - `printing`     — adapter de impressoras térmicas (ESC/POS)
//! - `parsing`      — parsers de formatos externos (OFX)

pub mod composition;
pub mod integrations;
pub mod messaging;
pub mod parsing;
pub mod persistence;
pub mod printing;
pub mod security;
pub mod storage;

// Fachada estável — os consumidores (`api`, testes) usam os caminhos raiz.
pub use composition::compose::{build_services, BuiltServices};
pub use messaging::eventos::{spawn_aviso_persister, spawn_pg_relay, EventBus};
pub use parsing::ofx;
pub use persistence::db::{connect, migrate};
pub use persistence::repositories;
pub use persistence::repositories::*;
pub use security::jwt::JwtIssuer;
pub use security::password::Argon2Hasher;
pub use storage::object_store::{build_store, FsStore, S3Store};
pub use storage::s3_probe;
