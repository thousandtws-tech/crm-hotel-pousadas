use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::Json;
use serde::Deserialize;

use clarituz_application::dto::*;
use clarituz_domain::entities::{NivelFidelidade, PushSubscription, RegraMatriz, RespostaRapida};
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
        "tem_documento": r.fnrh_documento_key.is_some(),
    })))
}

/// Upload da foto do documento na pré-ficha — imagem ≤4MB gravada no
/// object store sob `fnrh/{idreserva}.{ext}`; a chave vai para a reserva.
pub async fn pre_ficha_documento_post(
    State(st): State<AppState>,
    Path(token): Path<uuid::Uuid>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<StatusCode, ApiError> {
    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if !content_type.starts_with("image/") {
        return Err(DomainError::validacao("Envie uma imagem (png, jpg ou webp).").into());
    }
    if body.is_empty() || body.len() > 4 * 1024 * 1024 {
        return Err(DomainError::validacao("Imagem vazia ou maior que 4 MB.").into());
    }
    let idreserva = st.services.comunicacao.pre_ficha_idreserva(token).await?;
    let ext = content_type
        .strip_prefix("image/")
        .map_or_else(|| "bin".into(), |e| e.replace("jpeg", "jpg"));
    let key = format!("fnrh/{idreserva}.{ext}");
    st.store.put(&key, &body, content_type).await?;
    let anterior = st
        .services
        .comunicacao
        .gravar_documento_pre_ficha(token, &key)
        .await?;
    if let Some(antigo) = anterior.filter(|a| a != &key) {
        st.store.delete(&antigo).await.ok();
    }
    Ok(StatusCode::CREATED)
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
) -> Result<Json<serde_json::Value>, ApiError> {
    let fb = st
        .services
        .comunicacao
        .responder_avaliacao_hospede(token, &input)
        .await?;
    if fb.critica {
        // Nota baixa vira atendimento privado antes de virar review público.
        let _ = st
            .services
            .atendimento
            .abrir(
                "avaliacao",
                &fb.reserva,
                &format!(
                    "Avaliação crítica pós-estadia: nota geral {} — {}.",
                    input.nota_geral,
                    input.comentario.as_deref().unwrap_or("sem comentário")
                ),
                Some("avaliacao_critica"),
            )
            .await;
    }
    let google_url = if fb.promotor {
        st.services
            .estabelecimento
            .obter()
            .await
            .ok()
            .flatten()
            .and_then(|e| e.google_review_url)
    } else {
        None
    };
    Ok(Json(serde_json::json!({
        "critica": fb.critica,
        "google_url": google_url,
    })))
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

/// PDF legível dos dados do titular — baixado direto pelo portal.
pub async fn lgpd_pdf_publico(
    State(st): State<AppState>,
    Path(token): Path<uuid::Uuid>,
) -> Result<axum::response::Response, ApiError> {
    let pdf = st.services.comunicacao.lgpd_pdf_publico(token).await?;
    use axum::response::IntoResponse;
    Ok((
        [
            (axum::http::header::CONTENT_TYPE, "application/pdf"),
            (
                axum::http::header::CONTENT_DISPOSITION,
                "attachment; filename=\"meus-dados.pdf\"",
            ),
        ],
        pdf,
    )
        .into_response())
}

#[derive(Deserialize)]
pub struct EnviarDadosInput {
    pub canal: String,
}

/// Enfileira o documento do titular — e-mail com PDF anexo ou WhatsApp
/// com o link único do PDF. Mesmo token opaco que libera o portal.
pub async fn lgpd_enviar_publico(
    State(st): State<AppState>,
    Path(token): Path<uuid::Uuid>,
    Json(body): Json<EnviarDadosInput>,
) -> Result<StatusCode, ApiError> {
    use clarituz_domain::enums::CanalEnvio;
    let canal = match body.canal.as_str() {
        "email" => CanalEnvio::Email,
        "whatsapp" => CanalEnvio::Whatsapp,
        _ => return Err(DomainError::validacao("canal deve ser 'email' ou 'whatsapp'").into()),
    };
    st.services
        .comunicacao
        .lgpd_enviar_publico(token, canal)
        .await?;
    Ok(StatusCode::ACCEPTED)
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

/// GET /comunicacao/painel — as 6 leituras do boot da página em uma
/// única chamada, resolvidas em paralelo no servidor (tokio::join).
/// Campos gerenciais (avaliações, fila, matriz) vêm null para quem não
/// tem nível — antes eram 403 silenciosos em requests separados.
pub async fn painel_comunicacao(
    State(st): State<AppState>,
    ator: Ator,
) -> Result<Json<serde_json::Value>, ApiError> {
    let com = &st.services;
    let (lgpd, atendimentos) = tokio::join!(
        com.lgpd.listar_solicitacoes(None),
        com.atendimento.fila("aberto", None),
    );
    let (dash, avaliacoes, fila, matriz) = if ator.is_gerencial() {
        let (d, a, f, m) = tokio::join!(
            com.avaliacoes.dashboard(),
            com.avaliacoes.listar(None, 100),
            com.comunicacao.listar_fila(200),
            com.comunicacao.listar_matriz(),
        );
        (Some(d?), Some(a?), Some(f?), Some(m?))
    } else {
        (None, None, None, None)
    };
    Ok(Json(serde_json::json!({
        "avaliacoes_dash": dash,
        "avaliacoes": avaliacoes,
        "fila": fila,
        "matriz": matriz,
        "lgpd": lgpd?,
        "atendimentos": atendimentos?,
    })))
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

// ---------------------------------------------------------------------------
// Campanhas de marketing — blast WhatsApp para opt-ins LGPD (gerencial).
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct CampanhaInput {
    pub nome: String,
    pub texto: String,
}

pub async fn campanhas_listar(
    State(st): State<AppState>,
    ator: Ator,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(serde_json::json!(
        st.services.comunicacao.listar_campanhas(&ator).await?
    )))
}

pub async fn campanhas_criar(
    State(st): State<AppState>,
    ator: Ator,
    Json(input): Json<CampanhaInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let v = st
        .services
        .comunicacao
        .criar_campanha(&ator, &input.nome, &input.texto)
        .await?;
    Ok(Json(serde_json::json!(v)))
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

#[derive(serde::Deserialize)]
pub struct TransferirInput {
    pub setor: String,
}

/// Passa o protocolo pra outro setor — recepção ↔ governança ↔ manutenção.
pub async fn atendimento_transferir_post(
    State(st): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(input): Json<TransferirInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(serde_json::json!(
        st.services
            .atendimento
            .transferir(id, &input.setor, ator.id)
            .await?
    )))
}

pub async fn atendimento_notas_get(
    State(st): State<AppState>,
    _ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(serde_json::json!(
        st.services.atendimento.notas(id).await?
    )))
}

#[derive(serde::Deserialize)]
pub struct NotaInput {
    pub texto: String,
}

pub async fn atendimento_notas_post(
    State(st): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(input): Json<NotaInput>,
) -> Result<(StatusCode, Json<serde_json::Value>), ApiError> {
    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!(
            st.services
                .atendimento
                .anotar(id, &input.texto, ator.id)
                .await?
        )),
    ))
}

#[derive(serde::Deserialize)]
pub struct TagsInput {
    pub tags: Vec<String>,
}

pub async fn atendimento_tags_put(
    State(st): State<AppState>,
    _ator: Ator,
    Path(id): Path<i64>,
    Json(input): Json<TagsInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(serde_json::json!(
        st.services.atendimento.salvar_tags(id, &input.tags).await?
    )))
}

#[derive(serde::Deserialize)]
pub struct AgendarMsgInput {
    pub texto: String,
    pub agendado_para: chrono::DateTime<chrono::Utc>,
}

/// "Lembrete checkout amanhã 10h" — sai pelo WhatsApp do protocolo.
pub async fn atendimento_agendar_msg_post(
    State(st): State<AppState>,
    _ator: Ator,
    Path(id): Path<i64>,
    Json(input): Json<AgendarMsgInput>,
) -> Result<StatusCode, ApiError> {
    st.services
        .atendimento
        .agendar_mensagem(id, &input.texto, input.agendado_para)
        .await?;
    Ok(StatusCode::ACCEPTED)
}

// ---------------------------------------------------------------------------
// Respostas rápidas — catálogo '/atalho' (autocomplete dos campos de
// resposta). Leitura livre p/ atendentes; escrita restrita a gerência.
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct RespostaRapidaInput {
    pub atalho: String,
    pub titulo: String,
    pub texto: String,
    #[serde(default)]
    pub ordem: i16,
    #[serde(default = "default_true")]
    pub ativo: bool,
}

fn default_true() -> bool {
    true
}

pub async fn respostas_rapidas_get(
    State(st): State<AppState>,
    _ator: Ator,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(serde_json::json!(
        st.services.respostas_rapidas.listar().await?
    )))
}

pub async fn respostas_rapidas_post(
    State(st): State<AppState>,
    ator: Ator,
    Json(input): Json<RespostaRapidaInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let id = st
        .services
        .respostas_rapidas
        .gravar(
            &RespostaRapida {
                id: 0,
                atalho: input.atalho,
                titulo: input.titulo,
                texto: input.texto,
                ordem: input.ordem,
                ativo: input.ativo,
            },
            &ator,
        )
        .await?;
    Ok(Json(serde_json::json!({ "id": id })))
}

pub async fn respostas_rapidas_delete(
    State(st): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
) -> Result<StatusCode, ApiError> {
    st.services.respostas_rapidas.remover(id, &ator).await?;
    Ok(StatusCode::NO_CONTENT)
}
