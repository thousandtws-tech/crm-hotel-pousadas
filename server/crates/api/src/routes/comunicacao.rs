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
// público — Inná Concierge (portal do hóspede, escopo = token da reserva)
// ---------------------------------------------------------------------------

pub async fn concierge_get(
    State(st): State<AppState>,
    Path(token): Path<uuid::Uuid>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(st.services.concierge.abrir_portal(token).await?))
}

#[derive(Deserialize)]
pub struct MensagemConcierge {
    pub mensagem: String,
}

pub async fn concierge_post(
    State(st): State<AppState>,
    Path(token): Path<uuid::Uuid>,
    Json(body): Json<MensagemConcierge>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let texto = body.mensagem.trim();
    if texto.is_empty() || texto.chars().count() > 1000 {
        return Err(DomainError::validacao("mensagem inválida").into());
    }
    Ok(Json(
        st.services.concierge.mensagem_portal(token, texto).await?,
    ))
}

// ---------------------------------------------------------------------------
// webhook WhatsApp (Meta Cloud API) — verify GET + mensagens inbound POST
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct WaVerify {
    #[serde(rename = "hub.mode")]
    mode: String,
    #[serde(rename = "hub.verify_token")]
    token: String,
    #[serde(rename = "hub.challenge")]
    challenge: String,
}

/// Handshake da Meta: devolve o challenge quando o verify_token confere.
pub async fn whatsapp_verify(
    State(st): State<AppState>,
    Query(q): Query<WaVerify>,
) -> Result<String, StatusCode> {
    st.services
        .concierge
        .whatsapp_challenge(&q.mode, &q.token, &q.challenge)
        .ok_or(StatusCode::FORBIDDEN)
}

/// Mensagens inbound. A Meta reentrega até receber 200 — o processamento
/// (LLM + envio da resposta) roda em background e a dedup por wamid
/// descarta reentregas.
pub async fn whatsapp_inbound(
    State(st): State<AppState>,
    headers: axum::http::HeaderMap,
    body: axum::body::Bytes,
) -> StatusCode {
    // X-Hub-Signature-256 = "sha256=" + HMAC_SHA256(app_secret, corpo).
    if let Some(secret) = st.services.concierge.whatsapp_app_secret() {
        use hmac::{Hmac, Mac};
        use sha2::Sha256;
        let assinatura = headers
            .get("x-hub-signature-256")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("sha256="))
            .and_then(|v| hex::decode(v).ok());
        let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(secret.as_bytes()) else {
            return StatusCode::INTERNAL_SERVER_ERROR;
        };
        mac.update(&body);
        let Some(esperado) = assinatura else {
            return StatusCode::UNAUTHORIZED;
        };
        if mac.verify_slice(&esperado).is_err() {
            return StatusCode::UNAUTHORIZED;
        }
    } else {
        tracing::warn!("whatsapp webhook: WHATSAPP_APP_SECRET ausente — assinatura não validada");
    }

    let Ok(payload) = serde_json::from_slice::<serde_json::Value>(&body) else {
        return StatusCode::OK; // corpo ilegível não deve gerar reentrega
    };
    // Estrutura Meta: entry[].changes[].value.messages[] — só texto vira
    // conversa; status/read receipts não têm `messages`.
    let mensagens: Vec<(String, Option<String>, String)> = payload["entry"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|e| e["changes"].as_array().into_iter().flatten())
        .flat_map(|c| c["value"]["messages"].as_array().into_iter().flatten())
        .filter_map(|m| {
            let de = m["from"].as_str()?.to_string();
            let wamid = m["id"].as_str().map(str::to_string);
            let texto = match m["type"].as_str() {
                Some("text") => m["text"]["body"].as_str().unwrap_or_default().to_string(),
                _ => format!("[{}]", m["type"].as_str().unwrap_or("mensagem")),
            };
            Some((de, wamid, texto))
        })
        .collect();

    tokio::spawn(async move {
        for (de, wamid, texto) in mensagens {
            if let Err(e) = st
                .services
                .concierge
                .whatsapp_inbound(&de, wamid.as_deref(), &texto)
                .await
            {
                tracing::warn!(erro = %e, "whatsapp inbound: falha ao processar");
            }
        }
    });
    StatusCode::OK
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
