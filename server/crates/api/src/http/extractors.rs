use crate::http::state::AppState;
use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use clarituz_application::actor::{Ator, AtorBasico, RequestCtx};
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

#[allow(clippy::result_large_err)] // `Response` é o `Rejection` fixado pelo trait
fn extrair_ator(parts: &Parts, state: &AppState) -> Result<Ator, Response> {
    let token = parts
        .headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or_else(|| unauthorized("Token ausente."))?;

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
        financeiro: claims.financeiro,
    })
}

fn verificacao_pendente() -> Response {
    (
        StatusCode::FORBIDDEN,
        Json(json!({"erro": {
            "codigo": "VERIFICACAO_PENDENTE",
            "mensagem": "Verificação de identidade pendente — conclua o KYC para continuar."
        }})),
    )
        .into_response()
}

/// `Ator` = JWT válido + portão Didit (quando a integração exige).
/// Rotas que o funcionário bloqueado ainda precisa acessar usam
/// `AtorBasico` (só o JWT).
impl FromRequestParts<AppState> for Ator {
    type Rejection = Response;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let ator = extrair_ator(parts, state)?;
        if let Some(v) = &state.services.verificacao {
            if !v.acesso_permitido(ator.id, ator.is_admin()).await {
                return Err(verificacao_pendente());
            }
        }
        Ok(ator)
    }
}

/// Apenas JWT — portão Didit não se aplica (self-service da verificação).
impl FromRequestParts<AppState> for AtorBasico {
    type Rejection = Response;

    fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> impl std::future::Future<Output = Result<Self, Self::Rejection>> {
        std::future::ready(extrair_ator(parts, state).map(AtorBasico))
    }
}

impl FromRequestParts<AppState> for RequestCtx {
    type Rejection = std::convert::Infallible;

    fn from_request_parts(
        parts: &mut Parts,
        _state: &AppState,
    ) -> impl std::future::Future<Output = Result<Self, Self::Rejection>> {
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
        std::future::ready(Ok(RequestCtx { ip, user_agent }))
    }
}

#[allow(dead_code)]
pub fn domain_response(e: DomainError) -> Response {
    crate::http::error::ApiError::from(e).into_response()
}
