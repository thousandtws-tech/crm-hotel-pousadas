//! Endpoints de autenticação — públicos: login/refresh/logout; privado: me.

use crate::error::ApiError as AppError;
use crate::state::AppState;
use axum::extract::State;
use axum::Json;
use clarituz_application::actor::{Ator, RequestCtx};
use clarituz_application::dto::{
    FuncionarioView, LoginRequest, LogoutRequest, Mensagem, RefreshRequest, RegistroInput,
    TokenResponse,
};

pub async fn login(
    State(s): State<AppState>,
    ctx: RequestCtx,
    Json(body): Json<LoginRequest>,
) -> Result<Json<TokenResponse>, AppError> {
    Ok(Json(
        s.services
            .auth
            .login(&body.login, &body.senha, &ctx)
            .await?,
    ))
}

pub async fn refresh(
    State(s): State<AppState>,
    ctx: RequestCtx,
    Json(body): Json<RefreshRequest>,
) -> Result<Json<TokenResponse>, AppError> {
    Ok(Json(
        s.services.auth.refresh(&body.refresh_token, &ctx).await?,
    ))
}

pub async fn logout(
    State(s): State<AppState>,
    Json(body): Json<LogoutRequest>,
) -> Result<Json<Mensagem>, AppError> {
    s.services.auth.logout(&body.refresh_token).await?;
    Ok(Json(Mensagem::ok("Sessão encerrada.")))
}

pub async fn register(
    State(s): State<AppState>,
    Json(body): Json<RegistroInput>,
) -> Result<(axum::http::StatusCode, Json<Mensagem>), AppError> {
    s.services.funcionarios.registrar(body).await?;
    Ok((
        axum::http::StatusCode::CREATED,
        Json(Mensagem::ok(
            "Administrador cadastrado! Faça login para continuar.",
        )),
    ))
}

pub async fn me(State(s): State<AppState>, ator: Ator) -> Result<Json<FuncionarioView>, AppError> {
    Ok(Json(s.services.auth.me(ator.id).await?))
}
