//! `clarituz-infrastructure` — adapters concretos dos ports do domínio:
//! PostgreSQL via sqlx, Argon2id e JWT.

pub mod compose;
pub mod db;
pub mod escpos;
pub mod eventos;
pub mod jwt;
pub mod object_store;
pub mod ofx;
pub mod password;
pub mod repositories;
pub mod s3_probe;
pub mod stripe;

pub use compose::{build_services, BuiltServices};
pub use db::{connect, migrate};
pub use eventos::{spawn_aviso_persister, spawn_pg_relay, EventBus};
pub use jwt::JwtIssuer;
pub use object_store::{build_store, FsStore, S3Store};
pub use password::Argon2Hasher;
pub use repositories::*;
