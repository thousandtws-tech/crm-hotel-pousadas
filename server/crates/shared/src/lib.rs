//! `clarituz-shared` — kernel compartilhado, organizado por
//! responsabilidade:
//!
//! - `config`      — configuração centralizada (12-factor: tudo via ambiente)
//! - `pagination`  — contrato de paginação limit/offset com teto rígido
//! - `primitives`  — primitivos de negócio (ids, dinheiro `Decimal`, tempo)

pub mod config;
pub mod pagination;
pub mod primitives;

// Fachada estável — consumidores seguem usando os caminhos raiz.
pub use config::Settings;
pub use pagination::{Page, PageParams};
pub use primitives::{ids, money, time};
