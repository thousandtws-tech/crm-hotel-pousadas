//! Inteligência preditiva — endpoints somente-leitura do módulo Inná
//! (BI, risco, perfis, pace, escala ideal, upsell, estoque, manutenção
//! preventiva e contexto histórico). Todos exigem autenticação.

use axum::extract::State;
use axum::Json;
use clarituz_application::Ator;

use crate::http::error::ApiError as AppError;
use crate::http::state::AppState;

pub async fn ia_resumo(
    State(s): State<AppState>,
    ator: Ator,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(serde_json::json!(
        s.services.preditivo.resumo(&ator).await?
    )))
}

pub async fn ia_ocupacao(
    State(s): State<AppState>,
    ator: Ator,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(serde_json::json!(
        s.services.preditivo.ocupacao_14d(&ator).await?
    )))
}

pub async fn ia_receita(
    State(s): State<AppState>,
    ator: Ator,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(serde_json::json!(
        s.services.preditivo.receita_4sem(&ator).await?
    )))
}

pub async fn ia_fluxo(
    State(s): State<AppState>,
    ator: Ator,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(serde_json::json!(
        s.services.preditivo.fluxo_caixa_30d(&ator).await?
    )))
}

pub async fn ia_riscos(
    State(s): State<AppState>,
    ator: Ator,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(serde_json::json!(
        s.services.preditivo.risco_cancelamentos(&ator).await?
    )))
}

pub async fn ia_perfis(
    State(s): State<AppState>,
    ator: Ator,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(serde_json::json!(
        s.services.preditivo.perfis(&ator).await?
    )))
}

pub async fn ia_pace(
    State(s): State<AppState>,
    ator: Ator,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(serde_json::json!(
        s.services.preditivo.pace(&ator).await?
    )))
}

pub async fn ia_escala(
    State(s): State<AppState>,
    ator: Ator,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(serde_json::json!(
        s.services.preditivo.escala_ideal(&ator).await?
    )))
}

pub async fn ia_upsell(
    State(s): State<AppState>,
    ator: Ator,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(serde_json::json!(
        s.services.preditivo.upsells(&ator).await?
    )))
}

pub async fn ia_estoque(
    State(s): State<AppState>,
    ator: Ator,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(serde_json::json!(
        s.services.preditivo.estoque_previsto(&ator).await?
    )))
}

pub async fn ia_manutencao(
    State(s): State<AppState>,
    ator: Ator,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(serde_json::json!(
        s.services.preditivo.risco_quartos(&ator).await?
    )))
}

pub async fn ia_historico(
    State(s): State<AppState>,
    ator: Ator,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(serde_json::json!(
        s.services.preditivo.historico_12m(&ator).await?
    )))
}
