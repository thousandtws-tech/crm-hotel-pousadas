//! Erro da camada de aplicação.

use clarituz_domain::DomainError;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error(transparent)]
    Domain(#[from] DomainError),
}

/// Erros do provedor de distribuição sobem como regra de negócio —
/// classificação (retry/pendência) já aconteceu dentro do serviço.
impl From<clarituz_domain::ports::ErroDistribuicao> for AppError {
    fn from(e: clarituz_domain::ports::ErroDistribuicao) -> Self {
        DomainError::from(e).into()
    }
}

impl AppError {
    /// Referência ao erro de domínio encapsulado.
    pub fn domain(&self) -> &DomainError {
        match self {
            Self::Domain(e) => e,
        }
    }

    /// Código estável exposto na API.
    pub fn code(&self) -> &'static str {
        match self.domain() {
            DomainError::Validacao(_) => "VALIDACAO",
            DomainError::NaoEncontrado(_) => "NAO_ENCONTRADO",
            DomainError::Conflito(_) => "CONFLITO",
            DomainError::RegraNegocio(_) => "REGRA_NEGOCIO",
            DomainError::Proibido(_) => "PROIBIDO",
            DomainError::NaoAutenticado(_) => "NAO_AUTENTICADO",
            DomainError::Infra => "INTERNO",
        }
    }
}

pub type AppResult<T> = Result<T, AppError>;
