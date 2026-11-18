use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

use clarituz_application::dto::*;
use clarituz_domain::entities::{NivelFidelidade, PushSubscription, RegraMatriz};
use clarituz_domain::enums::StatusAvaliacao;
use clarituz_domain::error::DomainError;

use crate::http::error::ApiError;
use crate::http::state::AppState;
use clarituz_application::actor::Ator;
use clarituz_application::actor::RequestCtx;

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
    ctx: RequestCtx,
    Json(dados): Json<serde_json::Value>,
) -> Result<StatusCode, ApiError> {
    st.services
        .comunicacao
        .gravar_pre_ficha(token, &dados)
        .await?;
    if let Ok(Some(r)) = st.services.comunicacao.pre_ficha(token).await {
        let _ = st
            .services
            .lgpd
            .marcar_termos(r.idreserva, ctx.ip.as_deref().unwrap_or("desconhecido"))
            .await;
    }
    Ok(StatusCode::NO_CONTENT)
}

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

pub async fn lgpd_descadastrar(
    State(st): State<AppState>,
    Query(q): Query<std::collections::HashMap<String, String>>,
) -> axum::response::Html<&'static str> {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    let (Some(c), Some(s)) = (q.get("c"), q.get("s")) else {
        return axum::response::Html("<h2>Link inválido.</h2>");
    };
    let Ok(idcliente) = c.parse::<i64>() else {
        return axum::response::Html("<h2>Link inválido.</h2>");
    };
    let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(st.link_secret.as_bytes()) else {
        return axum::response::Html("<h2>Indisponível no momento.</h2>");
    };
    mac.update(format!("lgpd:{idcliente}").as_bytes());
    let Some(esperado) = hex::decode(s).ok() else {
        return axum::response::Html("<h2>Link inválido.</h2>");
    };
    if mac.verify_slice(&esperado).is_err() {
        return axum::response::Html("<h2>Link inválido.</h2>");
    }
    let _ = st.services.lgpd.opt_out_cliente(idcliente, "email").await;
    axum::response::Html(
        "<h2>Pronto — você foi descadastrado.</h2>\
         <p>Não enviaremos mais mensagens promocionais. Comunicações sobre \
         suas estadias seguem ativas.</p>",
    )
}

#[derive(Deserialize)]
pub struct SolicitacaoLgpd {
    pub tipo: String,
    pub detalhe: Option<String>,
}

pub async fn lgpd_solicitar(
    State(st): State<AppState>,
    Path(token): Path<uuid::Uuid>,
    Json(body): Json<SolicitacaoLgpd>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let r = st
        .services
        .comunicacao
        .pre_ficha(token)
        .await?
        .ok_or_else(|| DomainError::nao_encontrado("reserva não encontrada"))?;
    let id = st
        .services
        .lgpd
        .solicitar(
            Some(r.idcliente),
            Some(r.idreserva),
            body.tipo.trim(),
            body.detalhe
                .as_deref()
                .map(str::trim)
                .filter(|d| !d.is_empty()),
            "portal",
        )
        .await?;
    Ok(Json(serde_json::json!({"protocolo": id, "prazo_dias": 15})))
}

pub async fn lgpd_exportar_publico(
    State(st): State<AppState>,
    Path(token): Path<uuid::Uuid>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let r = st
        .services
        .comunicacao
        .pre_ficha(token)
        .await?
        .ok_or_else(|| DomainError::nao_encontrado("reserva não encontrada"))?;
    Ok(Json(
        st.services.lgpd.exportar_cliente(None, r.idcliente).await?,
    ))
}

pub async fn lgpd_listar(
    State(st): State<AppState>,
    ator: Ator,
    Query(q): Query<std::collections::HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let _ = &ator;
    let itens = st
        .services
        .lgpd
        .listar_solicitacoes(q.get("status").map(String::as_str))
        .await?;
    Ok(Json(serde_json::json!(itens)))
}

#[derive(Deserialize)]
pub struct RespostaLgpd {
    pub resposta: String,
}

pub async fn lgpd_responder(
    State(st): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(body): Json<RespostaLgpd>,
) -> Result<StatusCode, ApiError> {
    st.services
        .lgpd
        .responder_solicitacao(&ator, id, &body.resposta)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn lgpd_anonimizar(
    State(st): State<AppState>,
    ator: Ator,
    Path(idcliente): Path<i64>,
) -> Result<StatusCode, ApiError> {
    ator.exigir_gerencial()?;
    st.services
        .lgpd
        .anonimizar_cliente(&ator, idcliente)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn lgpd_exportar_admin(
    State(st): State<AppState>,
    ator: Ator,
    Path(idcliente): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(
        st.services
            .lgpd
            .exportar_cliente(Some(&ator), idcliente)
            .await?,
    ))
}

pub async fn lgpd_incidente_criar(
    State(st): State<AppState>,
    ator: Ator,
    Json(novo): Json<clarituz_domain::ports::NovoIncidente>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let id = st.services.lgpd.registrar_incidente(&ator, novo).await?;
    Ok(Json(serde_json::json!({"id": id})))
}

pub async fn lgpd_incidente_listar(
    State(st): State<AppState>,
    ator: Ator,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(serde_json::json!(
        st.services.lgpd.listar_incidentes(&ator).await?
    )))
}

#[derive(Deserialize)]
pub struct ComunicacaoIncidente {
    pub destino: String,
}

pub async fn lgpd_incidente_comunicar(
    State(st): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(body): Json<ComunicacaoIncidente>,
) -> Result<StatusCode, ApiError> {
    st.services
        .lgpd
        .marcar_comunicacao_incidente(&ator, id, body.destino.trim())
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct AutorizacaoMenor {
    pub documento: String,
}

pub async fn reserva_autorizacao_menor(
    State(st): State<AppState>,
    ator: Ator,
    Path(idreserva): Path<i64>,
    Json(body): Json<AutorizacaoMenor>,
) -> Result<StatusCode, ApiError> {
    let _ = &ator;
    if body.documento.trim().is_empty() {
        return Err(DomainError::validacao("Informe o documento da autorização.").into());
    }
    st.services
        .lgpd
        .marcar_autorizacao_menor(idreserva, body.documento.trim())
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct WaVerify {
    #[serde(rename = "hub.mode")]
    mode: String,
    #[serde(rename = "hub.verify_token")]
    token: String,
    #[serde(rename = "hub.challenge")]
    challenge: String,
}

pub async fn whatsapp_verify(
    State(st): State<AppState>,
    Query(q): Query<WaVerify>,
) -> Result<String, StatusCode> {
    st.services
        .concierge
        .whatsapp_challenge(&q.mode, &q.token, &q.challenge)
        .ok_or(StatusCode::FORBIDDEN)
}

pub async fn whatsapp_inbound(
    State(st): State<AppState>,
    headers: axum::http::HeaderMap,
    body: axum::body::Bytes,
) -> StatusCode {
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
        return StatusCode::OK;
    };
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

pub async fn webhook_zapi(
    State(st): State<AppState>,
    Path(segredo): Path<String>,
    body: axum::body::Bytes,
) -> StatusCode {
    let Some(zapi) = &st.services.zapi else {
        return StatusCode::SERVICE_UNAVAILABLE; // módulo sem cofre
    };
    let Ok(payload) = serde_json::from_slice::<serde_json::Value>(&body) else {
        return StatusCode::BAD_REQUEST;
    };
    let instance = payload["instanceId"].as_str().unwrap_or_default();
    let Ok(Some(idintegracao)) = zapi.autenticar(&segredo, instance).await else {
        return StatusCode::UNAUTHORIZED;
    };
    match zapi.receber(&payload, idintegracao).await {
        Ok(_) => StatusCode::OK,
        Err(e) => {
            tracing::warn!(erro = %e, "zapi webhook: processamento falhou");
            StatusCode::INTERNAL_SERVER_ERROR
        }
    }
}

/// DLR Infobip — delivery reports do canal SMS. Segredo no path é a
/// autenticação (notification profiles aceitam URL arbitrária); a
/// inbox deduplica antes de qualquer efeito na fila.
pub async fn webhook_infobip(
    State(st): State<AppState>,
    Path(segredo): Path<String>,
    body: axum::body::Bytes,
) -> StatusCode {
    let Some(infobip) = &st.services.infobip else {
        return StatusCode::SERVICE_UNAVAILABLE; // módulo sem cofre
    };
    let Ok(payload) = serde_json::from_slice::<serde_json::Value>(&body) else {
        return StatusCode::BAD_REQUEST;
    };
    let Ok(Some(idintegracao)) = infobip.autenticar(&segredo).await else {
        return StatusCode::UNAUTHORIZED;
    };
    match infobip.receber(&payload, idintegracao).await {
        Ok(_) => StatusCode::OK,
        Err(e) => {
            tracing::warn!(erro = %e, "infobip webhook: processamento falhou");
            StatusCode::INTERNAL_SERVER_ERROR
        }
    }
}

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

pub async fn fila_listar(
    State(st): State<AppState>,
    ator: Ator,
) -> Result<Json<serde_json::Value>, ApiError> {
    ator.exigir_gerencial()?;
    let itens = st.services.comunicacao.listar_fila(200).await?;
    Ok(Json(serde_json::json!(itens)))
}

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

pub async fn atendimentos_get(
    State(st): State<AppState>,
    ator: Ator,
    Query(q): Query<std::collections::HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let _ = &ator;
    let itens = st
        .services
        .atendimento
        .fila(
            q.get("status").map_or("aberto", String::as_str),
            q.get("setor").map(String::as_str),
        )
        .await?;
    Ok(Json(serde_json::json!(itens)))
}

pub async fn atendimento_aceitar_post(
    State(st): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(serde_json::json!(
        st.services.atendimento.aceitar(id, ator.id).await?
    )))
}

pub async fn atendimento_resolver_post(
    State(st): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(serde_json::json!(
        st.services.atendimento.resolver(id, ator.id).await?
    )))
}
