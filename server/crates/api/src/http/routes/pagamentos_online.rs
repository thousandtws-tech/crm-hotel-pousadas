//! Pagamentos online — checkout público (site), webhook Stripe e
//! administração financeira (listagem, resumo, reembolso).
//!
//! Segurança: o webhook valida `Stripe-Signature` sobre o **corpo bruto**
//! antes de parsear; rotas públicas identificam a reserva pelo token
//! opaco (anti-enumeração); reembolso exige a permissão `financeiro`.

use crate::http::error::ApiError as AppError;
use crate::http::state::AppState;
use axum::body::Bytes;
use axum::extract::{Path, Query, RawQuery, State};
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use clarituz_application::actor::Ator;
use clarituz_application::dto::{
    CheckoutPublicoInput, CheckoutPublicoOutput, ReembolsarPagamentoInput, ReembolsoOutput,
    StatusPublicoOutput,
};
use clarituz_domain::entities::{AmbienteIntegracao, ProvedorIntegracao};
use clarituz_domain::enums::StatusPagamento;
use clarituz_domain::ports::{
    FiltroPagamento, NovoEventoWebhook, PagamentoView, ReceitaAcomodacao, ResumoFinanceiro,
};
use clarituz_domain::DomainError;
use clarituz_shared::{Page, PageParams};
use serde::Deserialize;
use tracing::warn;
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
// upsell do portal — token opaco da reserva (mesmo escopo do concierge)
// ---------------------------------------------------------------------------

/// Ofertas compráveis calculadas no servidor — o portal exibe o que o
/// hóspede pode pagar agora (early/late/upgrade disponíveis).
pub async fn ofertas_portal(
    State(s): State<AppState>,
    Path(token): Path<Uuid>,
) -> Result<Json<Vec<clarituz_application::dto::OfertaUpsell>>, AppError> {
    Ok(Json(s.services.reservas.ofertas_upsell(token).await?))
}

/// Checkout de um extra — a rota compõe os dois serviços: a oferta é
/// revalidada (disponibilidade + preço) e só então vira cobrança
/// `tipo = 'extra'`. O efeito na reserva acontece só no webhook.
pub async fn checkout_extra_portal(
    State(s): State<AppState>,
    Path(token): Path<Uuid>,
    Json(input): Json<clarituz_application::dto::CheckoutExtraInput>,
) -> Result<Json<CheckoutPublicoOutput>, AppError> {
    let oferta = s
        .services
        .reservas
        .oferta_para_checkout(token, &input)
        .await?;
    Ok(Json(
        s.services
            .pagamentos_online
            .criar_checkout_extra(token, &oferta)
            .await?,
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
    // Precedência do segredo de webhook: integração persistida
    // `stripe/producao` governa; sem linha → `STRIPE_WEBHOOK_SECRET`
    // do env (legado). Uma linha existente NUNCA cai no env — mesmo
    // desabilitada ou sem segredo (configuração explícita governa).
    let (secret, idintegracao) = match s.services.integracoes.as_ref() {
        Some(svc) => {
            match svc
                .buscar_integracao(ProvedorIntegracao::Stripe, AmbienteIntegracao::Producao)
                .await?
            {
                Some(i) => (
                    svc.segredo_webhook(i.id, "webhook_secret")
                        .await?
                        .ok_or_else(|| {
                            DomainError::regra("Webhook secret não configurado na integração.")
                        })?,
                    Some(i.id),
                ),
                None => (
                    s.stripe_webhook_secret.clone().ok_or_else(|| {
                        DomainError::regra("Webhook de pagamento não configurado.")
                    })?,
                    None,
                ),
            }
        }
        None => (
            s.stripe_webhook_secret
                .clone()
                .ok_or_else(|| DomainError::regra("Webhook de pagamento não configurado."))?,
            None,
        ),
    };
    let assinatura = headers
        .get("stripe-signature")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| DomainError::nao_autenticado("Assinatura ausente."))?;

    clarituz_infrastructure::integrations::stripe::verificar_assinatura(
        &secret, &corpo, assinatura,
    )?;

    let payload: serde_json::Value = serde_json::from_slice(&corpo)
        .map_err(|_| DomainError::validacao("Payload de webhook inválido."))?;
    let event_id = payload["id"].as_str().unwrap_or_default().to_string();
    let event_type = payload["type"].as_str().unwrap_or_default().to_string();

    // Inbox idempotente — duplicado entra como no-op e já responde 200.
    // Evento sem `id` não pode ser deduplicado na inbox (event_id é
    // UNIQUE NOT NULL — dois eventos sem id colidiriam entre si):
    // processa direto, sem registro. A Stripe sempre envia `id` — a
    // ausência num payload assinado é anomalia que vale log, não drop.
    let novo = if event_id.is_empty() {
        tracing::warn!(tipo = %event_type, "webhook Stripe sem id — processando fora da inbox");
        true
    } else {
        s.services
            .pagamentos_online
            .registrar_evento(&NovoEventoWebhook {
                provedor: "stripe".into(),
                event_id: event_id.clone(),
                event_type: event_type.clone(),
                payload: payload.clone(),
                idintegracao,
            })
            .await?
    };
    if !novo {
        return Ok(StatusCode::OK);
    }

    let evento = clarituz_domain::entities::WebhookEvento {
        id: 0,
        provedor: "stripe".into(),
        event_id,
        event_type,
        payload,
        idintegracao,
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
                    &evento.provedor,
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
                    &evento.provedor,
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
// webhooks PagBank + Mercado Pago
// ---------------------------------------------------------------------------

/// Autentica o evento contra cada integração habilitada do provedor —
/// a que validar processa (multi-ambiente: mesmo endpoint serve teste
/// e produção; o segredo correspondente é quem desempata).
async fn integracao_autenticada<F>(
    s: &AppState,
    provedor: ProvedorIntegracao,
    campo_segredo: &str,
    verificar: F,
) -> Result<Option<clarituz_domain::entities::Integracao>, AppError>
where
    F: Fn(&str) -> bool,
{
    let Some(svc) = s.services.integracoes.as_ref() else {
        return Ok(None);
    };
    for i in svc.habilitadas(provedor).await? {
        if let Some(secret) = svc.segredo_webhook(i.id, campo_segredo).await? {
            if verificar(&secret) {
                return Ok(Some(i));
            }
        }
    }
    Ok(None)
}

/// Processamento compartilhado pós-autenticação: inbox idempotente +
/// dispatch para o service — sempre 200 (retry fica no sweeper).
async fn processar_webhook_provedor(
    s: &AppState,
    integ: &clarituz_domain::entities::Integracao,
    event_id: String,
    event_type: String,
    payload: serde_json::Value,
) -> Result<StatusCode, AppError> {
    let novo = s
        .services
        .pagamentos_online
        .registrar_evento(&NovoEventoWebhook {
            provedor: integ.provedor.as_str().into(),
            event_id: event_id.clone(),
            event_type: event_type.clone(),
            payload: payload.clone(),
            idintegracao: Some(integ.id),
        })
        .await?;
    if !novo {
        return Ok(StatusCode::OK);
    }
    let evento = clarituz_domain::entities::WebhookEvento {
        id: 0,
        provedor: integ.provedor.as_str().into(),
        event_id,
        event_type,
        payload,
        idintegracao: Some(integ.id),
        status: clarituz_domain::enums::StatusProcWebhook::Recebido,
        tentativas: 0,
        ultimo_erro: None,
        recebido_em: chrono::Utc::now(),
        processado_em: None,
    };
    let status_proc = match s.services.pagamentos_online.processar_evento(&evento).await {
        Ok(()) => clarituz_domain::enums::StatusProcWebhook::Processado,
        Err(_) => clarituz_domain::enums::StatusProcWebhook::Falhou,
    };
    let _ = s
        .services
        .pagamentos_online
        .marcar_evento(&evento.provedor, &evento.event_id, status_proc, None)
        .await;
    Ok(StatusCode::OK)
}

/// POST /api/v1/webhooks/mercadopago — `x-signature` HMAC obrigatória;
/// estado real vem do fetch-back no processamento (payload nunca é
/// fonte de verdade).
pub async fn webhook_mercadopago(
    State(s): State<AppState>,
    headers: HeaderMap,
    RawQuery(query): RawQuery,
    corpo: Bytes,
) -> Result<StatusCode, AppError> {
    let assinatura = headers
        .get("x-signature")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| DomainError::nao_autenticado("Assinatura ausente."))?;
    let request_id = headers
        .get("x-request-id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let payload: serde_json::Value = serde_json::from_slice(&corpo)
        .map_err(|_| DomainError::validacao("Payload de webhook inválido."))?;
    // O MP assina com o `data.id` da query string quando presente
    // (`?data.id=…&type=payment`); o corpo é o fallback — perder essa
    // precedência invalida a assinatura de notificações legadas.
    let data_id = query
        .as_deref()
        .and_then(|q| {
            q.split('&').find_map(|par| {
                par.strip_prefix("data.id=")
                    .or_else(|| par.strip_prefix("id="))
                    .map(str::to_owned)
            })
        })
        .or_else(|| {
            payload["data"]["id"]
                .as_str()
                .map(str::to_string)
                .or_else(|| payload["data"]["id"].as_i64().map(|i| i.to_string()))
        })
        .unwrap_or_default();

    let integ = integracao_autenticada(
        &s,
        ProvedorIntegracao::Mercadopago,
        "webhook_secret",
        |secret| {
            clarituz_infrastructure::integrations::mercadopago::verificar_assinatura(
                secret,
                assinatura,
                &request_id,
                &data_id,
            )
            .is_ok()
        },
    )
    .await?
    .ok_or_else(|| {
        warn!(
            data_id,
            assinatura,
            request_id,
            tem_query = query.is_some(),
            "webhook mercadopago: assinatura rejeitada"
        );
        DomainError::nao_autenticado("Assinatura de webhook inválida.")
    })?;

    let event_id = format!(
        "mp-{}-{}",
        payload["action"].as_str().unwrap_or("event"),
        data_id
    );
    let event_type = payload["type"].as_str().unwrap_or("payment").to_string();
    processar_webhook_provedor(&s, &integ, event_id, event_type, payload).await
}

/// POST /api/v1/webhooks/pagbank — autenticação por `x-authenticity-token`
/// quando configurado; a prova definitiva é o fetch-back da ordem no
/// processamento (estado só vem da API, nunca do payload).
pub async fn webhook_pagbank(
    State(s): State<AppState>,
    headers: HeaderMap,
    corpo: Bytes,
) -> Result<StatusCode, AppError> {
    let token = headers
        .get("x-authenticity-token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let payload: serde_json::Value = serde_json::from_slice(&corpo)
        .map_err(|_| DomainError::validacao("Payload de webhook inválido."))?;

    // Autentica contra cada integração habilitada com token configurado;
    // se nenhuma tem token configurado, a primeira habilitada processa —
    // a autenticidade real vem do fetch-back (somente estado real da
    // conta é aplicado, então evento forjado não produz efeito).
    let Some(svc) = s.services.integracoes.as_ref() else {
        return Err(DomainError::regra("Integrações não configuradas.").into());
    };
    let habilitadas = svc.habilitadas(ProvedorIntegracao::Pagbank).await?;
    if habilitadas.is_empty() {
        return Err(DomainError::regra("Nenhuma integração PagBank habilitada.").into());
    }
    let mut integ = None;
    let mut algum_token = false;
    for i in &habilitadas {
        if let Some(esperado) = svc.segredo_webhook(i.id, "authenticity_token").await? {
            algum_token = true;
            if clarituz_infrastructure::integrations::pagbank::verificar_authenticity_token(
                &esperado, &token,
            )
            .is_ok()
            {
                integ = Some(i.clone());
                break;
            }
        }
    }
    let integ = match (integ, algum_token) {
        (Some(i), _) => i,
        (None, true) => {
            return Err(DomainError::nao_autenticado("Token de autenticidade inválido.").into())
        }
        (None, false) => habilitadas[0].clone(),
    };

    let charge_id = payload["charges"]
        .get(0)
        .and_then(|c| c["id"].as_str())
        .unwrap_or_default();
    let event_id = if charge_id.is_empty() {
        payload["id"].as_str().unwrap_or_default().to_string()
    } else {
        charge_id.to_string()
    };
    if event_id.is_empty() {
        return Err(DomainError::validacao("Notificação sem identificador.").into());
    }
    processar_webhook_provedor(&s, &integ, event_id, "payment".into(), payload).await
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
