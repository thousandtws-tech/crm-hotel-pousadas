//! Ports de autenticação — contratos de hashing e emissão de tokens.
//! Implementações: Argon2id e JWT (HS256) na infraestrutura.

use crate::error::DomainError;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

/// Claims do access token (sub = id do funcionário, serializado como
/// string conforme RFC 7519 — `jsonwebtoken` exige `sub` textual na
/// validação de required claims).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenClaims {
    pub sub: String,
    pub login: String,
    pub nome: String,
    pub nivel: i16,
    /// Permissão granular financeira do funcionário — `false` em tokens
    /// emitidos antes da flag existir (serde default, retrocompatível).
    #[serde(default)]
    pub financeiro: bool,
    pub exp: i64,
    pub iat: i64,
    pub iss: String,
    /// `Some("sse")` nos stream tickets de vida curta — ausente nos access
    /// tokens; permite escopo de uso sem um segundo issuer.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aud: Option<String>,
}

#[async_trait]
pub trait PasswordHasher: Send + Sync {
    /// Argon2id — memória-hard; hash já carrega sal e parâmetros.
    fn hash(&self, senha: &str) -> Result<String, DomainError>;
    /// Verificação em tempo constante.
    fn verify(&self, senha: &str, hash: &str) -> Result<bool, DomainError>;
}

#[async_trait]
pub trait TokenIssuer: Send + Sync {
    fn emitir(&self, claims: &TokenClaims) -> Result<String, DomainError>;
    fn validar(&self, token: &str) -> Result<TokenClaims, DomainError>;
}
