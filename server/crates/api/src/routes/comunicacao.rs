//! Rotas do módulo de comunicação — público (token opaco), admin e
//! webhooks de provedores (Resend bounces, WhatsApp inbound).

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

use clarituz_application::dto::*;
use clarituz_domain::entities::{NivelFidelidade, PushSubscription, RegraMatriz};
use clarituz_domain::enums::StatusAvaliacao;
use clarituz_domain::error::DomainError;

use crate::error::ApiError;
use crate::state::AppState;
use clarituz_application::actor::Ator;

// ---------------------------------------------------------------------------
// público — pré-ficha FNRH (token da reserva, anti-enumeração)
// ---------------------------------------------------------------------------

pub async fn pre_ficha_get(
    State(st): State<AppState>,
    Path(token): Path<uuid::Uuid>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let r = st.services.comunicacao.pre_ficha(token).await?;
    let Some(r) = r else {
        return Err(DomainError::nao_encontrado("ficha não encontrada").into());
    };
    Ok(Json(serde_json::json!({
        "cliente_nome": r.cliente_nome,
        "acomodacao": r.acomodacao_nome,
        "entrada": r.entradaprevista,
        "saida": r.saidaprevista,
    })))
}

pub async fn pre_ficha_post(
    State(st): State<AppState>,
    Path(token): Path<uuid::Uuid>,
    Json(dados): Json<serde_json::Value>,
) -> Result<StatusCode, ApiError> {
    // Aceita o json do formulário tal qual — imutável após preenchida.
    st.services
        .comunicacao
        .gravar_pre_ficha(token, &dados)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// público — pesquisa de avaliação
// ---------------------------------------------------------------------------

pub async fn avaliacao_get(
    State(st): State<AppState>,
    Path(token): Path<uuid::Uuid>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let av = st.services.comunicacao.avaliacao_publica(token).await?;
    Ok(Json(serde_json::json!({
        "respondida": av.status == StatusAvaliacao::Respondida,
        "comentario": av.comentario,
        "resposta": av.resposta,
        "nota_geral": av.nota_geral,
    })))
}

pub async fn avaliacao_post(
    State(st): State<AppState>,
    Path(token): Path<uuid::Uuid>,
    Json(input): Json<RespostaAvaliacaoInput>,
) -> Result<StatusCode, ApiError> {
    st.services
        .comunicacao
        .responder_avaliacao_hospede(token, &input)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// webhook Resend — bounces/complaints viram supressão imediata
// ---------------------------------------------------------------------------

pub async fn webhook_resend(
    State(st): State<AppState>,
    Json(evento): Json<serde_json::Value>,
) -> StatusCode {
    let tipo = evento["type"].as_str().unwrap_or_default();
    let email = evento["data"]["to"]
        .as_array()
        .and_then(|a| a.first())
        .and_then(|v| v.as_str())
        .or_else(|| evento["data"]["email"].as_str());
    if matches!(
        tipo,
        "email.bounced" | "email.complained" | "email.suppressed"
    ) {
        if let Some(email) = email {
            let _ = st.services.comunicacao.suprimir_email(email, tipo).await;
        }
    }
    StatusCode::OK
}

// ---------------------------------------------------------------------------
// admin — fila de envio (monitor)
// ---------------------------------------------------------------------------

pub async fn fila_listar(
    State(st): State<AppState>,
    ator: Ator,
) -> Result<Json<serde_json::Value>, ApiError> {
    ator.exigir_gerencial()?;
    let itens = st.services.comunicacao.listar_fila(200).await?;
    Ok(Json(serde_json::json!(itens)))
}

// ---------------------------------------------------------------------------
// admin — matriz evento × canal × papel
// ---------------------------------------------------------------------------

pub async fn matriz_listar(
    State(st): State<AppState>,
    ator: Ator,
) -> Result<Json<serde_json::Value>, ApiError> {
    ator.exigir_gerencial()?;
    Ok(Json(serde_json::json!(
        st.services.comunicacao.listar_matriz().await?
    )))
}

pub async fn matriz_gravar(
    State(st): State<AppState>,
    ator: Ator,
    Json(input): Json<MatrizRegraInput>,
) -> Result<StatusCode, ApiError> {
    ator.exigir_gerencial()?;
    if !(1..=3).contains(&input.papel) {
        return Err(DomainError::validacao("papel deve ser 1 (admin), 2 ou 3").into());
    }
    st.services
        .comunicacao
        .gravar_regra(&RegraMatriz {
            evento: input.evento,
            canal: input.canal,
            papel: input.papel,
            ativo: input.ativo,
        })
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// admin — avaliações
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct AvaliacaoFiltro {
    status: Option<String>,
    limite: Option<i64>,
}

pub async fn avaliacoes_listar(
    State(st): State<AppState>,
    ator: Ator,
    Query(q): Query<AvaliacaoFiltro>,
) -> Result<Json<serde_json::Value>, ApiError> {
    ator.exigir_gerencial()?;
    let status = q.status.as_deref().and_then(|s| match s {
        "pendente" => Some(StatusAvaliacao::Pendente),
        "respondida" => Some(StatusAvaliacao::Respondida),
        "expirada" => Some(StatusAvaliacao::Expirada),
        _ => None,
    });
    Ok(Json(serde_json::json!(
        st.services
            .avaliacoes
            .listar(status, q.limite.unwrap_or(100))
            .await?
    )))
}

pub async fn avaliacoes_dashboard(
    State(st): State<AppState>,
    ator: Ator,
) -> Result<Json<serde_json::Value>, ApiError> {
    ator.exigir_gerencial()?;
    Ok(Json(st.services.avaliacoes.dashboard().await?))
}

pub async fn avaliacao_responder(
    State(st): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(input): Json<ResponderAvaliacaoInput>,
) -> Result<StatusCode, ApiError> {
    st.services
        .avaliacoes
        .responder(id, &input.resposta, &ator)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// admin — fidelidade
// ---------------------------------------------------------------------------

pub async fn fidelidade_niveis_get(
    State(st): State<AppState>,
    _ator: Ator,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(serde_json::json!(
        st.services.fidelidade.niveis().await?
    )))
}

pub async fn fidelidade_niveis_post(
    State(st): State<AppState>,
    ator: Ator,
    Json(input): Json<NivelFidelidadeInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let id = st
        .services
        .fidelidade
        .gravar_nivel(
            &NivelFidelidade {
                id: 0,
                nome: input.nome,
                min_diarias: input.min_diarias,
                desconto_pct: input.desconto_pct,
                beneficios: input.beneficios,
                ordem: input.ordem,
                ativo: input.ativo,
            },
            &ator,
        )
        .await?;
    Ok(Json(serde_json::json!({ "id": id })))
}

pub async fn fidelidade_niveis_delete(
    State(st): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
) -> Result<StatusCode, ApiError> {
    st.services.fidelidade.remover_nivel(id, &ator).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn cliente_perfil360(
    State(st): State<AppState>,
    _ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(st.services.fidelidade.perfil360(id).await?))
}

// ---------------------------------------------------------------------------
// push — subscription do PWA (funcionário autenticado)
// ---------------------------------------------------------------------------

pub async fn push_subscribe(
    State(st): State<AppState>,
    ator: Ator,
    Json(input): Json<PushSubscriptionInput>,
) -> Result<StatusCode, ApiError> {
    st.services
        .comunicacao
        .gravar_subscription(&PushSubscription {
            id: 0,
            idfuncionario: ator.id,
            endpoint: input.endpoint,
            p256dh: input.p256dh,
            auth: input.auth,
            user_agent: input.user_agent,
        })
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
pub struct UnsubscribeInput {
    endpoint: String,
}

pub async fn push_unsubscribe(
    State(st): State<AppState>,
    _ator: Ator,
    Json(input): Json<UnsubscribeInput>,
) -> Result<StatusCode, ApiError> {
    st.services
        .comunicacao
        .remover_subscription(&input.endpoint)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn push_vapid_key(State(st): State<AppState>) -> Json<serde_json::Value> {
    Json(serde_json::json!({ "publica": st.vapid_public_b64 }))
}

// ---------------------------------------------------------------------------
// admin — cobrança manual por e-mail/WhatsApp
// ---------------------------------------------------------------------------

pub async fn cobranca_enviar(
    State(st): State<AppState>,
    ator: Ator,
    Path(idreserva): Path<i64>,
    Json(input): Json<CobrancaInput>,
) -> Result<StatusCode, ApiError> {
    ator.exigir_financeiro()?;
    let r = st
        .services
        .comunicacao
        .reserva_auto_publica(idreserva)
        .await?
        .ok_or_else(|| ApiError::from(DomainError::nao_encontrado("reserva não encontrada")))?;
    st.services
        .comunicacao
        .enviar_cobranca(&r, &input.link_pagamento)
        .await;
    Ok(StatusCode::NO_CONTENT)
}
