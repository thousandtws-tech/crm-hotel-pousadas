//! Extratores: `Ator` autenticado via Bearer JWT e contexto da requisição.

use crate::state::AppState;
use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use clarituz_application::actor::{Ator, RequestCtx};
use clarituz_domain::enums::NivelAcesso;
use clarituz_domain::DomainError;
use serde_json::json;

fn unauthorized(msg: &str) -> Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(json!({"erro": {"codigo": "NAO_AUTENTICADO", "mensagem": msg}})),
    )
        .into_response()
}

/// Extrai e valida o `Authorization: Bearer <jwt>` → `Ator`.
impl FromRequestParts<AppState> for Ator {
    type Rejection = Response;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        // Bearer header, ou `?token=` para clientes sem controle de header
        // (EventSource/SSE). JWT é base64url — não precisa de URL-decode.
        let bearer = parts
            .headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .map(str::to_string);
        let token = bearer
            .or_else(|| {
                parts
                    .uri
                    .query()
                    .and_then(|q| q.split('&').find_map(|p| p.strip_prefix("token=")))
                    .map(str::to_string)
            })
            .ok_or_else(|| unauthorized("Token ausente."))?;

        let token = token.as_str();

        let claims = state
            .issuer
            .validar(token)
            .map_err(|_| unauthorized("Token inválido ou expirado."))?;

        let id = claims
            .sub
            .parse::<i64>()
            .map_err(|_| unauthorized("Token inválido ou expirado."))?;

        Ok(Ator {
            id,
            login: claims.login,
            nome: claims.nome,
            nivel: NivelAcesso::from_i16(claims.nivel),
        })
    }
}

/// IP + User-Agent do cliente para auditoria e sessões.
impl FromRequestParts<AppState> for RequestCtx {
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(
        parts: &mut Parts,
        _state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let ip = parts
            .headers
            .get("x-forwarded-for")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.split(',').next())
            .map(|s| s.trim().to_string())
            .or_else(|| {
                parts
                    .extensions
                    .get::<axum::extract::ConnectInfo<std::net::SocketAddr>>()
                    .map(|c| c.0.ip().to_string())
            });
        let user_agent = parts
            .headers
            .get(header::USER_AGENT)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.chars().take(255).collect());
        Ok(RequestCtx { ip, user_agent })
    }
}

/// Converte `DomainError` em resposta (uso pontual em handlers que não
/// passam por `AppResult`).
#[allow(dead_code)]
pub fn domain_response(e: DomainError) -> Response {
    crate::error::ApiError::from(e).into_response()
}
