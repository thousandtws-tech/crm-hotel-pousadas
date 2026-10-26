//! `clarituz-application` — camada de aplicação: casos de uso orquestrando
//! ports do domínio. Não conhece HTTP nem SQL.

pub mod actor;
pub mod dto;
pub mod error;
pub mod services;

pub use actor::Ator;
pub use error::AppError;
pub use services::Services;
