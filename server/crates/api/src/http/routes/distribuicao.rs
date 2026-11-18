//! Distribuição (Channex) — configuração, mapeamento e operação.
//! Público: `POST /webhooks/channex/{ambiente}` — HMAC sobre corpo cru.

use crate::http::error::ApiError as AppError;
use crate::http::state::AppState;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use chrono::NaiveDate;
use clarituz_application::actor::Ator;
use clarituz_application::services::ChannexService;
use clarituz_domain::entities::AmbienteIntegracao;
use clarituz_domain::DomainError;
use serde::Deserialize;
use std::sync::Arc;

fn svc(s: &AppState) -> Result<&Arc<ChannexService>, AppError> {
    s.services
        .distribuicao
        .as_ref()
        .ok_or_else(|| DomainError::regra("Distribuição indisponível.").into())
}

fn amb(ambiente: &str) -> Result<AmbienteIntegracao, AppError> {
    AmbienteIntegracao::parse(ambiente)
        .ok_or_else(|| DomainError::nao_encontrado("Ambiente desconhecido.").into())
}

// -- configuração / mapeamento ----------------------------------------------

pub async fn propriedades(
    State(s): State<AppState>,
    ator: Ator,
    Path(ambiente): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(
        serde_json::json!({ "data": svc(&s)?.propriedades(&ator, amb(&ambiente)?).await? }),
    ))
}

#[derive(Deserialize)]
pub struct VinculoInput {
    pub property_id: String,
}

pub async fn vincular(
    State(s): State<AppState>,
    ator: Ator,
    Path(ambiente): Path<String>,
    Json(i): Json<VinculoInput>,
) -> Result<StatusCode, AppError> {
    svc(&s)?
        .vincular_propriedade(&ator, amb(&ambiente)?, i.property_id.trim())
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn opcoes(
    State(s): State<AppState>,
    ator: Ator,
    Path(ambiente): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(
        serde_json::json!({ "data": svc(&s)?.opcoes(&ator, amb(&ambiente)?).await? }),
    ))
}

pub async fn mapeamentos(
    State(s): State<AppState>,
    ator: Ator,
    Path(ambiente): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(
        serde_json::json!({ "data": svc(&s)?.mapeamentos(&ator, amb(&ambiente)?).await? }),
    ))
}

#[derive(Deserialize)]
pub struct MapearInput {
    pub idacomodacao: i64,
    pub room_type_id: String,
    pub rate_plan_id: String,
}

pub async fn mapear(
    State(s): State<AppState>,
    ator: Ator,
    Path(ambiente): Path<String>,
    Json(i): Json<MapearInput>,
) -> Result<StatusCode, AppError> {
    svc(&s)?
        .mapear(
            &ator,
            amb(&ambiente)?,
            i.idacomodacao,
            i.room_type_id.trim(),
            i.rate_plan_id.trim(),
        )
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn desmapear(
    State(s): State<AppState>,
    ator: Ator,
    Path((ambiente, id)): Path<(String, i64)>,
) -> Result<StatusCode, AppError> {
    svc(&s)?.desmapear(&ator, amb(&ambiente)?, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

// -- sincronização / operação ------------------------------------------------

#[derive(Deserialize)]
pub struct SincronizarInput {
    pub inicio: NaiveDate,
    pub fim: NaiveDate,
}

pub async fn sincronizar(
    State(s): State<AppState>,
    ator: Ator,
    Path(ambiente): Path<String>,
    Json(i): Json<SincronizarInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    let n = svc(&s)?
        .sincronizar(&ator, amb(&ambiente)?, i.inicio, i.fim)
        .await?;
    Ok(Json(serde_json::json!({ "enfileirados": n })))
}

pub async fn reconciliar(
    State(s): State<AppState>,
    ator: Ator,
    Path(ambiente): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let n = svc(&s)?.reconciliar(&ator, amb(&ambiente)?).await?;
    Ok(Json(serde_json::json!({ "enfileirados": n })))
}

#[derive(Deserialize)]
pub struct PausaInput {
    pub pausada: bool,
}

pub async fn pausar(
    State(s): State<AppState>,
    ator: Ator,
    Path(ambiente): Path<String>,
    Json(i): Json<PausaInput>,
) -> Result<StatusCode, AppError> {
    svc(&s)?
        .pausar_publicacao(&ator, amb(&ambiente)?, i.pausada)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn revisoes(
    State(s): State<AppState>,
    ator: Ator,
    Path(ambiente): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(
        serde_json::json!({ "data": svc(&s)?.revisoes(&ator, amb(&ambiente)?).await? }),
    ))
}

pub async fn pendencias(
    State(s): State<AppState>,
    ator: Ator,
    Path(ambiente): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(
        serde_json::json!({ "data": svc(&s)?.pendencias(&ator, amb(&ambiente)?, true).await? }),
    ))
}

pub async fn resolver_pendencia(
    State(s): State<AppState>,
    ator: Ator,
    Path((_ambiente, id)): Path<(String, i64)>,
) -> Result<StatusCode, AppError> {
    svc(&s)?.resolver_pendencia(&ator, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn reprocessar(
    State(s): State<AppState>,
    ator: Ator,
    Path((ambiente, revision_id)): Path<(String, String)>,
) -> Result<StatusCode, AppError> {
    svc(&s)?
        .reprocessar_revisao(&ator, amb(&ambiente)?, &revision_id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn envios(
    State(s): State<AppState>,
    ator: Ator,
    Path(ambiente): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(
        serde_json::json!({ "data": svc(&s)?.envios(&ator, amb(&ambiente)?).await? }),
    ))
}

pub async fn resumo(
    State(s): State<AppState>,
    ator: Ator,
    Path(ambiente): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(
        serde_json::json!({ "data": svc(&s)?.resumo(&ator, amb(&ambiente)?).await? }),
    ))
}

pub async fn registrar_webhook(
    State(s): State<AppState>,
    ator: Ator,
    Path(ambiente): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let base = s.api_base.clone().unwrap_or_else(|| s.site_base.clone());
    let url = svc(&s)?
        .registrar_webhook(&ator, amb(&ambiente)?, &base)
        .await?;
    Ok(Json(serde_json::json!({ "webhook_url": url })))
}

pub async fn token_iframe(
    State(s): State<AppState>,
    ator: Ator,
    Path(ambiente): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let t = svc(&s)?.token_iframe(&ator, amb(&ambiente)?).await?;
    Ok(Json(serde_json::to_value(t).unwrap_or_default()))
}

// -- webhook público ---------------------------------------------------------

/// `POST /webhooks/channex/{ambiente}` — `x-hmac-timestamp` (s, ±5min) +
/// `x-hmac-signature-256` (hex, CSV p/ rotação) sobre `{ts}.{corpo cru}`.
pub async fn webhook_channex(
    State(s): State<AppState>,
    Path(ambiente): Path<String>,
    headers: HeaderMap,
    corpo: Bytes,
) -> StatusCode {
    let Some(dist) = &s.services.distribuicao else {
        return StatusCode::SERVICE_UNAVAILABLE;
    };
    let Some(a) = AmbienteIntegracao::parse(&ambiente) else {
        return StatusCode::NOT_FOUND;
    };

    let header = |nome: &str| {
        headers
            .get(nome)
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default()
            .to_string()
    };
    let (sigs, ts) = (header("x-hmac-signature-256"), header("x-hmac-timestamp"));

    let Ok(Some(segredo)) = dist.webhook_secret(a).await else {
        return StatusCode::UNAUTHORIZED;
    };
    match clarituz_infrastructure::integrations::channex::verificar_assinatura(
        &segredo, &ts, &corpo, &sigs,
    ) {
        Ok(true) => {}
        _ => return StatusCode::UNAUTHORIZED,
    }

    let Ok(payload) = serde_json::from_slice::<serde_json::Value>(&corpo) else {
        return StatusCode::BAD_REQUEST;
    };
    match dist.webhook_receber(a, &payload).await {
        Ok(_) => StatusCode::OK,
        Err(e) => {
            tracing::warn!(erro = %e, "channex webhook: processamento falhou");
            StatusCode::INTERNAL_SERVER_ERROR
        }
    }
}

// -- router -------------------------------------------------------------------

pub fn rotas() -> Router<AppState> {
    Router::new()
        .route("/distribuicao/{ambiente}/propriedades", get(propriedades))
        .route("/distribuicao/{ambiente}/propriedade", post(vincular))
        .route("/distribuicao/{ambiente}/opcoes", get(opcoes))
        .route(
            "/distribuicao/{ambiente}/mapeamentos",
            get(mapeamentos).post(mapear),
        )
        .route(
            "/distribuicao/{ambiente}/mapeamentos/{id}",
            delete(desmapear),
        )
        .route("/distribuicao/{ambiente}/sincronizar", post(sincronizar))
        .route("/distribuicao/{ambiente}/reconciliar", post(reconciliar))
        .route("/distribuicao/{ambiente}/publicacao", post(pausar))
        .route("/distribuicao/{ambiente}/revisoes", get(revisoes))
        .route("/distribuicao/{ambiente}/pendencias", get(pendencias))
        .route(
            "/distribuicao/{ambiente}/pendencias/{id}/resolver",
            post(resolver_pendencia),
        )
        .route(
            "/distribuicao/{ambiente}/revisoes/{revision_id}/reprocessar",
            post(reprocessar),
        )
        .route("/distribuicao/{ambiente}/envios", get(envios))
        .route("/distribuicao/{ambiente}/resumo", get(resumo))
        .route("/distribuicao/{ambiente}/webhook", post(registrar_webhook))
        .route("/distribuicao/{ambiente}/iframe", post(token_iframe))
}
