use crate::error::DomainError;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenClaims {
    pub sub: String,
    pub login: String,
    pub nome: String,
    pub nivel: i16,

    #[serde(default)]
    pub financeiro: bool,
    pub exp: i64,
    pub iat: i64,
    pub iss: String,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aud: Option<String>,
}

#[async_trait]
pub trait PasswordHasher: Send + Sync {
    fn hash(&self, senha: &str) -> Result<String, DomainError>;
    fn verify(&self, senha: &str, hash: &str) -> Result<bool, DomainError>;
}

#[async_trait]
pub trait TokenIssuer: Send + Sync {
    fn emitir(&self, claims: &TokenClaims) -> Result<String, DomainError>;
    fn validar(&self, token: &str) -> Result<TokenClaims, DomainError>;
}
