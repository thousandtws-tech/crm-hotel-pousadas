//! `clarituz-infrastructure` — adapters concretos dos ports do domínio:
//! PostgreSQL via sqlx, Argon2id e JWT.

pub mod db;
pub mod escpos;
pub mod eventos;
pub mod jwt;
pub mod password;
pub mod repositories;

pub use db::{connect, migrate};
pub use eventos::{spawn_aviso_persister, spawn_pg_relay, EventBus};
pub use jwt::JwtIssuer;
pub use password::Argon2Hasher;
pub use repositories::*;
