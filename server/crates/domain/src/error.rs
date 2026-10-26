//! Erros tipados de domínio — nunca strings soltas como mecanismo de erro.

use thiserror::Error;

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum DomainError {
    /// Entrada malformada ou inválida (HTTP 400).
    #[error("{0}")]
    Validacao(String),

    /// Recurso não encontrado (HTTP 404).
    #[error("{0}")]
    NaoEncontrado(String),

    /// Conflito de estado ou unicidade (HTTP 409).
    #[error("{0}")]
    Conflito(String),

    /// Regra de negócio violada (HTTP 422).
    #[error("{0}")]
    RegraNegocio(String),

    /// Ação não autorizada para o ator atual (HTTP 403).
    #[error("{0}")]
    Proibido(String),

    /// Falha de autenticação (HTTP 401).
    #[error("{0}")]
    NaoAutenticado(String),

    /// Falha técnica de infraestrutura (HTTP 500) — o domínio não a
    /// conhece; adapters mapeiam erros internos para esta variante.
    #[error("falha interna de infraestrutura")]
    Infra,
}

impl DomainError {
    pub fn validacao(msg: impl Into<String>) -> Self {
        Self::Validacao(msg.into())
    }
    pub fn nao_encontrado(msg: impl Into<String>) -> Self {
        Self::NaoEncontrado(msg.into())
    }
    pub fn conflito(msg: impl Into<String>) -> Self {
        Self::Conflito(msg.into())
    }
    pub fn regra(msg: impl Into<String>) -> Self {
        Self::RegraNegocio(msg.into())
    }
    pub fn proibido(msg: impl Into<String>) -> Self {
        Self::Proibido(msg.into())
    }
    pub fn nao_autenticado(msg: impl Into<String>) -> Self {
        Self::NaoAutenticado(msg.into())
    }
}
