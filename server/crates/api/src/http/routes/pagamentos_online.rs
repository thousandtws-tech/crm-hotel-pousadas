//! Pagamentos online — checkout público (site), webhook Stripe e
//! administração financeira (listagem, resumo, reembolso).
//!
//! Segurança: o webhook valida `Stripe-Signature` sobre o **corpo bruto**
//! antes de parsear; rotas públicas identificam a reserva pelo token
//! opaco (anti-enumeração); reembolso exige a permissão `financeiro`.

use crate::http::error::ApiError as AppError;
use crate::http::state::AppState;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use clarituz_application::actor::Ator;
use clarituz_application::dto::{
    CheckoutPublicoInput, CheckoutPublicoOutput, ReembolsarPagamentoInput, ReembolsoOutput,
    StatusPublicoOutput,
};
use clarituz_domain::enums::StatusPagamento;
use clarituz_domain::ports::{
    FiltroPagamento, NovoEventoWebhook, PagamentoView, ReceitaAcomodacao, ResumoFinanceiro,
};
use clarituz_domain::DomainError;
use clarituz_shared::{Page, PageParams};
use serde::Deserialize;
use uuid::Uuid;

// ---------------------------------------------------------------------------
// público (site — sem auth; identificação por token opaco)
// ---------------------------------------------------------------------------

pub async fn checkout_publico(
    State(s): State<AppState>,
    Json(input): Json<CheckoutPublicoInput>,
) -> Result<Json<CheckoutPublicoOutput>, AppError> {
    Ok(Json(
        s.services
            .pagamentos_online
            .criar_checkout_publico(input)
            .await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct StatusQuery {
    pub token: Uuid,
}

pub async fn status_publico(
    State(s): State<AppState>,
    Query(q): Query<StatusQuery>,
) -> Result<Json<StatusPublicoOutput>, AppError> {
    Ok(Json(
        s.services.pagamentos_online.status_publico(q.token).await?,
    ))
}

// ---------------------------------------------------------------------------
// webhook Stripe
// ---------------------------------------------------------------------------

/// POST /api/v1/webhooks/stripe — sem auth: a autenticação é a assinatura
/// HMAC do provedor sobre o corpo bruto.
///
/// Responde sempre 200 após assinatura válida — falha de processamento
/// fica na inbox para o sweeper (não delegamos retry à Stripe, que
/// reenviaria o evento e inflaria a fila de entregas).
pub async fn webhook_stripe(
    State(s): State<AppState>,
    headers: HeaderMap,
    corpo: Bytes,
) -> Result<StatusCode, AppError> {
    let secret = s
        .stripe_webhook_secret
        .as_deref()
        .ok_or_else(|| DomainError::regra("Webhook de pagamento não configurado."))?;
    let assinatura = headers
        .get("stripe-signature")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| DomainError::nao_autenticado("Assinatura ausente."))?;

    clarituz_infrastructure::integrations::stripe::verificar_assinatura(
        secret, &corpo, assinatura,
    )?;

    let payload: serde_json::Value = serde_json::from_slice(&corpo)
        .map_err(|_| DomainError::validacao("Payload de webhook inválido."))?;
    let event_id = payload["id"].as_str().unwrap_or_default().to_string();
    let event_type = payload["type"].as_str().unwrap_or_default().to_string();

    // Inbox idempotente — duplicado entra como no-op e já responde 200.
    let novo = s
        .services
        .pagamentos_online
        .registrar_evento(&NovoEventoWebhook {
            event_id: event_id.clone(),
            event_type: event_type.clone(),
            payload: payload.clone(),
        })
        .await?;
    if !novo {
        return Ok(StatusCode::OK);
    }

    let evento = clarituz_domain::entities::WebhookEvento {
        id: 0,
        event_id,
        event_type,
        payload,
        status: clarituz_domain::enums::StatusProcWebhook::Recebido,
        tentativas: 0,
        ultimo_erro: None,
        recebido_em: chrono::Utc::now(),
        processado_em: None,
    };
    match s.services.pagamentos_online.processar_evento(&evento).await {
        Ok(()) => {
            axum_prometheus::metrics::counter!("clarituz_pagamentos_webhook_processados_total")
                .increment(1);
            s.services
                .pagamentos_online
                .marcar_evento(
                    &evento.event_id,
                    clarituz_domain::enums::StatusProcWebhook::Processado,
                    None,
                )
                .await?;
        }
        Err(e) => {
            axum_prometheus::metrics::counter!("clarituz_pagamentos_webhook_falhas_total")
                .increment(1);
            s.services
                .pagamentos_online
                .marcar_evento(
                    &evento.event_id,
                    clarituz_domain::enums::StatusProcWebhook::Falhou,
                    Some(&e.to_string()),
                )
                .await?;
        }
    }
    Ok(StatusCode::OK)
}

// ---------------------------------------------------------------------------
// admin (auth + permissões)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct PagamentosQuery {
    #[serde(flatten)]
    pub page: PageParams,
    pub inicio: Option<chrono::NaiveDate>,
    pub fim: Option<chrono::NaiveDate>,
    pub status: Option<StatusPagamento>,
    pub metodo: Option<String>,
    pub idreserva: Option<i64>,
    pub busca: Option<String>,
}

pub async fn listar_pagamentos(
    State(s): State<AppState>,
    _ator: Ator,
    Query(q): Query<PagamentosQuery>,
) -> Result<Json<Page<PagamentoView>>, AppError> {
    let filtro = FiltroPagamento {
        inicio: q.inicio,
        fim: q.fim,
        status: q.status,
        metodo: q.metodo,
        idreserva: q.idreserva,
        busca: q.busca,
    };
    Ok(Json(
        s.services.pagamentos_online.listar(&filtro, q.page).await?,
    ))
}

pub async fn pagamentos_da_reserva(
    State(s): State<AppState>,
    _ator: Ator,
    Path(idreserva): Path<i64>,
) -> Result<Json<Vec<clarituz_domain::entities::PagamentoOnline>>, AppError> {
    Ok(Json(
        s.services
            .pagamentos_online
            .listar_da_reserva(idreserva)
            .await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct PeriodoQuery {
    pub inicio: chrono::NaiveDate,
    pub fim: chrono::NaiveDate,
}

pub async fn resumo_financeiro(
    State(s): State<AppState>,
    ator: Ator,
    Query(q): Query<PeriodoQuery>,
) -> Result<Json<ResumoFinanceiro>, AppError> {
    Ok(Json(
        s.services
            .pagamentos_online
            .resumo(&ator, q.inicio, q.fim)
            .await?,
    ))
}

pub async fn receita_acomodacoes(
    State(s): State<AppState>,
    ator: Ator,
    Query(q): Query<PeriodoQuery>,
) -> Result<Json<Vec<ReceitaAcomodacao>>, AppError> {
    Ok(Json(
        s.services
            .pagamentos_online
            .receita_por_acomodacao(&ator, q.inicio, q.fim)
            .await?,
    ))
}

pub async fn reembolsar_pagamento(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(input): Json<ReembolsarPagamentoInput>,
) -> Result<(StatusCode, Json<ReembolsoOutput>), AppError> {
    Ok((
        StatusCode::CREATED,
        Json(
            s.services
                .pagamentos_online
                .reembolsar(&ator, id, input)
                .await?,
        ),
    ))
}
