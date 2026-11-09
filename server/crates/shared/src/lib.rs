//! `clarituz-shared` — kernel compartilhado: configuração, paginação e utilitários
//! de data/dinheiro usados por todas as camadas.

pub mod config;
pub mod ids;
pub mod money;
pub mod pagination;
pub mod time;

pub use config::Settings;
pub use pagination::{Page, PageParams};
