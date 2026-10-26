//! `clarituz-domain` — camada de domínio pura.
//!
//! Sem dependência de framework web, banco ou I/O: apenas entidades,
//! objetos de valor, enums de negócio, erros de domínio e *ports*
//! (contratos de repositório/serviço) implementados pela infraestrutura.

pub mod entities;
pub mod enums;
pub mod error;
pub mod events;
pub mod ports;
pub mod queries;
pub mod value_objects;

pub use error::DomainError;
pub use ports::auth::TokenClaims;
