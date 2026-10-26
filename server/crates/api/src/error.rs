//! Mapeamento AppError → resposta HTTP consistente.
//!
//! Formato: `{ "erro": { "codigo": "...", "mensagem": "..." } }`.
//! Detalhes internos nunca vazam — `Infra` rende mensagem genérica.

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use clarituz_application::AppError;
use clarituz_domain::DomainError;
use serde_json::json;

/// Wrapper local de `AppError` — exigido pela orphan rule para
/// implementar `IntoResponse` (trait externa em tipo externo).
#[derive(Debug)]
pub struct ApiError(pub AppError);

impl From<AppError> for ApiError {
    fn from(e: AppError) -> Self {
        Self(e)
    }
}

impl From<DomainError> for ApiError {
    fn from(e: DomainError) -> Self {
        Self(e.into())
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, mensagem) = match self.0.domain() {
            DomainError::Validacao(m) => (StatusCode::BAD_REQUEST, m.clone()),
            DomainError::NaoEncontrado(m) => (StatusCode::NOT_FOUND, m.clone()),
            DomainError::Conflito(m) => (StatusCode::CONFLICT, m.clone()),
            DomainError::RegraNegocio(m) => (StatusCode::UNPROCESSABLE_ENTITY, m.clone()),
            DomainError::Proibido(m) => (StatusCode::FORBIDDEN, m.clone()),
            DomainError::NaoAutenticado(m) => (StatusCode::UNAUTHORIZED, m.clone()),
            DomainError::Infra => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Erro interno. Tente novamente.".to_string(),
            ),
        };

        let body = json!({
            "erro": {
                "codigo": self.0.code(),
                "mensagem": mensagem,
            }
        });
        (status, Json(body)).into_response()
    }
}
