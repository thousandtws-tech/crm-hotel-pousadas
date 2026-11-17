//! Rotas fiscais — NFS-e via integração Spedy.
//!
//! Admin: configuração da empresa/município/webhook, preparação e
//! confirmação de emissão por reserva, acompanhamento, cancelamento e
//! download dos documentos oficiais.
//! Público: `POST /webhooks/spedy/{ambiente}` — assinatura obrigatória.

use crate::http::error::ApiError as AppError;
use crate::http::state::AppState;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::Response;
use axum::Json;
use clarituz_application::actor::Ator;
use clarituz_application::services::fiscal::{FiscalService, PrepararNfseInput, WebhookResultado};
use clarituz_domain::entities::{AmbienteIntegracao, StatusFiscal};
use clarituz_domain::ports::FiltroDocumentos;
use clarituz_domain::DomainError;
use std::sync::Arc;

fn svc(s: &AppState) -> Result<&Arc<FiscalService>, AppError> {
    s.services
        .fiscal
        .as_ref()
        .ok_or_else(|| DomainError::regra("Módulo fiscal não configurado (vault ausente).").into())
}

fn amb(ambiente: &str) -> Result<AmbienteIntegracao, AppError> {
    AmbienteIntegracao::parse(ambiente)
        .ok_or_else(|| DomainError::nao_encontrado("Ambiente desconhecido.").into())
}

// -- configuração -----------------------------------------------------------

pub async fn spedy_empresa(
    State(s): State<AppState>,
    ator: Ator,
    Path(ambiente): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let a = amb(&ambiente)?;
    let emp = svc(&s)?.vincular_empresa(&ator, a).await?;
    Ok(Json(serde_json::json!(emp)))
}

pub async fn spedy_municipio(
    State(s): State<AppState>,
    ator: Ator,
    Path((ambiente, ibge)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, AppError> {
    let a = amb(&ambiente)?;
    Ok(Json(svc(&s)?.municipio_settings(&ator, a, &ibge).await?))
}

pub async fn spedy_settings(
    State(s): State<AppState>,
    ator: Ator,
    Path(ambiente): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let a = amb(&ambiente)?;
    Ok(Json(svc(&s)?.empresa_settings(&ator, a).await?))
}

pub async fn spedy_webhook_config(
    State(s): State<AppState>,
    ator: Ator,
    Path(ambiente): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let a = amb(&ambiente)?;
    let base = s
        .api_base
        .clone()
        .ok_or_else(|| DomainError::regra("PUBLIC_API_URL não configurada."))?;
    let url = svc(&s)?.configurar_webhook(&ator, a, &base).await?;
    Ok(Json(serde_json::json!({ "webhook_url": url })))
}

// -- emissão e acompanhamento -------------------------------------------------

pub async fn preparar_nfse(
    State(s): State<AppState>,
    ator: Ator,
    Path((ambiente, idreserva)): Path<(String, i64)>,
    Json(input): Json<PrepararNfseInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    let a = amb(&ambiente)?;
    Ok(Json(serde_json::json!(
        svc(&s)?.preparar_nfse(&ator, a, idreserva, input).await?
    )))
}

pub async fn confirmar_doc(
    State(s): State<AppState>,
    ator: Ator,
    Path(iddoc): Path<i64>,
) -> Result<StatusCode, AppError> {
    svc(&s)?.confirmar(&ator, iddoc).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(serde::Deserialize)]
pub struct FiltroDocQuery {
    idreserva: Option<i64>,
    status: Option<String>,
    de: Option<chrono::NaiveDate>,
    ate: Option<chrono::NaiveDate>,
    ambiente: Option<String>,
    pagina: Option<i64>,
    por_pagina: Option<i64>,
}

pub async fn listar_docs(
    State(s): State<AppState>,
    ator: Ator,
    Query(q): Query<FiltroDocQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let status = q
        .status
        .as_deref()
        .map(|s| StatusFiscal::from(s.to_string()));
    let ambiente = q.ambiente.as_deref().and_then(AmbienteIntegracao::parse);
    let (docs, total) = svc(&s)?
        .listar(
            &ator,
            FiltroDocumentos {
                idreserva: q.idreserva,
                status,
                de: q.de,
                ate: q.ate,
                ambiente,
                pagina: q.pagina.unwrap_or(1),
                por_pagina: q.por_pagina.unwrap_or(25),
            },
        )
        .await?;
    Ok(Json(
        serde_json::json!({ "documentos": docs, "total": total }),
    ))
}

pub async fn docs_reserva(
    State(s): State<AppState>,
    ator: Ator,
    Path(idreserva): Path<i64>,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(serde_json::json!(
        svc(&s)?.por_reserva(&ator, idreserva).await?
    )))
}

pub async fn detalhe_doc(
    State(s): State<AppState>,
    ator: Ator,
    Path(iddoc): Path<i64>,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(serde_json::json!(
        svc(&s)?.detalhe(&ator, iddoc).await?
    )))
}

pub async fn sincronizar_doc(
    State(s): State<AppState>,
    ator: Ator,
    Path(iddoc): Path<i64>,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(serde_json::json!(
        svc(&s)?.sincronizar(&ator, iddoc).await?
    )))
}

pub async fn reconciliar_doc(
    State(s): State<AppState>,
    ator: Ator,
    Path(iddoc): Path<i64>,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(serde_json::json!(
        svc(&s)?.reconciliar(&ator, iddoc).await?
    )))
}

pub async fn reprocessar_doc(
    State(s): State<AppState>,
    ator: Ator,
    Path(iddoc): Path<i64>,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(serde_json::json!(
        svc(&s)?.reprocessar(&ator, iddoc).await?
    )))
}

#[derive(serde::Deserialize)]
pub struct CancelarInput {
    motivo: String,
}

pub async fn cancelar_doc(
    State(s): State<AppState>,
    ator: Ator,
    Path(iddoc): Path<i64>,
    Json(input): Json<CancelarInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(serde_json::json!(
        svc(&s)?.cancelar(&ator, iddoc, &input.motivo).await?
    )))
}

pub async fn arquivo_doc(
    State(s): State<AppState>,
    ator: Ator,
    Path((iddoc, tipo)): Path<(i64, String)>,
) -> Result<Response, AppError> {
    let (bytes, nome) = svc(&s)?.arquivo(&ator, iddoc, &tipo).await?;
    let mime = match tipo.as_str() {
        "pdf" => "application/pdf",
        "xml" => "application/xml",
        _ => return Err(DomainError::validacao("tipo inválido").into()),
    };
    let mut resp = Response::new(axum::body::Body::from(bytes));
    resp.headers_mut().insert(
        axum::http::header::CONTENT_TYPE,
        HeaderValue::from_static(mime),
    );
    if let Ok(v) = HeaderValue::from_str(&format!("attachment; filename=\"{nome}\"")) {
        resp.headers_mut()
            .insert(axum::http::header::CONTENT_DISPOSITION, v);
    }
    Ok(resp)
}

// -- webhook público -----------------------------------------------------------

/// `POST /webhooks/spedy/{ambiente}` — verificação Standard Webhooks
/// (HMAC-SHA256 de `id.timestamp.body`); o evento é persistido antes
/// do 2xx e deduplicado por `event_id`.
pub async fn webhook_spedy(
    State(s): State<AppState>,
    Path(ambiente): Path<String>,
    headers: HeaderMap,
    corpo: Bytes,
) -> StatusCode {
    let Some(fiscal) = &s.services.fiscal else {
        return StatusCode::SERVICE_UNAVAILABLE;
    };
    let Some(a) = AmbienteIntegracao::parse(&ambiente) else {
        return StatusCode::NOT_FOUND;
    };
    let Ok(payload) = serde_json::from_slice::<serde_json::Value>(&corpo) else {
        return StatusCode::BAD_REQUEST;
    };

    let header = |nome: &str| {
        headers
            .get(nome)
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default()
            .to_string()
    };
    let (id, ts, sig) = (
        header("webhook-id"),
        header("webhook-timestamp"),
        header("webhook-signature"),
    );

    // Assinatura obrigatória — sem segredo configurado ou sem headers
    // válidos o evento é recusado antes de qualquer efeito.
    let segredo = match fiscal.webhook_secret(a).await {
        Ok(Some(s)) => s,
        _ => return StatusCode::UNAUTHORIZED,
    };
    let valido = clarituz_infrastructure::integrations::spedy::verificar_assinatura(
        &segredo, &id, &ts, &corpo, &sig,
    )
    .unwrap_or(false);
    if !valido {
        return StatusCode::UNAUTHORIZED;
    }

    let event_id = if id.is_empty() {
        payload["id"].as_str().unwrap_or_default().to_string()
    } else {
        id
    };
    match fiscal.webhook_receber(a, &event_id, payload).await {
        Ok(WebhookResultado::Processado | WebhookResultado::Duplicado) => StatusCode::OK,
        Err(e) => {
            tracing::warn!(erro = %e, "spedy webhook: processamento falhou");
            StatusCode::INTERNAL_SERVER_ERROR
        }
    }
}
