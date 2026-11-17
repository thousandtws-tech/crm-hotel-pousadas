//! Rotas de verificação de identidade — KYC de funcionários via Didit.
//!
//! Autenticado (qualquer funcionário): `GET /verificacao/minha` (portão
//! de login) e `POST /verificacao/minha/sessao` (cria/recupera o link).
//! Gerencial+: listar, status e sessão por funcionário, sincronização.
//! Admin: configuração do workflow/portão e registro do webhook.
//! Público: `POST /webhooks/didit/{ambiente}` — assinatura obrigatória.

use crate::http::error::ApiError as AppError;
use crate::http::state::AppState;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use clarituz_application::actor::{Ator, AtorBasico};
use clarituz_application::services::verificacao::{ResultadoWebhook, VerificacaoService};
use clarituz_domain::entities::AmbienteIntegracao;
use clarituz_domain::DomainError;
use clarituz_shared::PageParams;
use std::sync::Arc;

fn svc(s: &AppState) -> Result<&Arc<VerificacaoService>, AppError> {
    s.services
        .verificacao
        .as_ref()
        .ok_or_else(|| DomainError::regra("Verificação não configurada (vault ausente).").into())
}

fn amb(ambiente: &str) -> Result<AmbienteIntegracao, AppError> {
    AmbienteIntegracao::parse(ambiente)
        .ok_or_else(|| DomainError::nao_encontrado("Ambiente desconhecido.").into())
}

// -- self-service (portão de login) --------------------------------------

/// Status do funcionário autenticado + flag do portão — chamado pelo
/// guard do admin a cada navegação quando a verificação é exigida.
/// `AtorBasico`: acessível mesmo com verificação pendente.
pub async fn minha(
    State(s): State<AppState>,
    ator: AtorBasico,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(serde_json::json!(svc(&s)?.minha(&ator.0).await?)))
}

/// Cria (ou recupera a viva) a sessão hospedada do próprio funcionário —
/// sempre na integração de produção. `AtorBasico`: é a rota que destrava
/// o bloqueado — não pode ficar atrás do portão.
pub async fn minha_sessao(
    State(s): State<AppState>,
    ator: AtorBasico,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(serde_json::json!(
        svc(&s)?.minha_sessao(&ator.0).await?
    )))
}

// -- gestão (gerencial+) ---------------------------------------------------

#[derive(serde::Deserialize)]
pub struct AmbienteQuery {
    ambiente: Option<String>,
    #[serde(flatten)]
    page: PageParams,
}

fn amb_q(q: &AmbienteQuery) -> Result<AmbienteIntegracao, AppError> {
    match q.ambiente.as_deref() {
        Some(a) => amb(a),
        None => Ok(AmbienteIntegracao::Producao),
    }
}

pub async fn listar(
    State(s): State<AppState>,
    ator: Ator,
    Query(q): Query<AmbienteQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(serde_json::json!(
        svc(&s)?.listar(&ator, q.page, amb_q(&q)?).await?
    )))
}

pub async fn status_funcionario(
    State(s): State<AppState>,
    ator: Ator,
    Path(idfuncionario): Path<i64>,
    Query(q): Query<AmbienteQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(serde_json::json!(
        svc(&s)?
            .status_funcionario(&ator, idfuncionario, amb_q(&q)?)
            .await?
    )))
}

pub async fn sessao_funcionario(
    State(s): State<AppState>,
    ator: Ator,
    Path(idfuncionario): Path<i64>,
    Query(q): Query<AmbienteQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(serde_json::json!(
        svc(&s)?
            .sessao_para(&ator, idfuncionario, amb_q(&q)?)
            .await?
    )))
}

pub async fn sincronizar(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<uuid::Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(serde_json::json!(
        svc(&s)?.sincronizar(&ator, id).await?
    )))
}

// -- configuração (admin) ---------------------------------------------------

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiditConfigInput {
    pub workflow_id: Option<String>,
    pub callback_url: Option<String>,
    pub exigir_verificacao: Option<bool>,
}

pub async fn didit_config(
    State(s): State<AppState>,
    ator: Ator,
    Path(ambiente): Path<String>,
    Json(input): Json<DiditConfigInput>,
) -> Result<StatusCode, AppError> {
    let a = amb(&ambiente)?;
    svc(&s)?
        .configurar(
            &ator,
            a,
            input.workflow_id,
            input.callback_url,
            input.exigir_verificacao.unwrap_or(false),
        )
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn didit_webhook_config(
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

// -- webhook público --------------------------------------------------------

/// `POST /webhooks/didit/{ambiente}` — `X-Signature` (HMAC-SHA256 do corpo
/// cru) + `X-Timestamp` ±5 min obrigatórios; o evento é persistido antes
/// do 2xx e deduplicado por `event_id`.
pub async fn webhook_didit(
    State(s): State<AppState>,
    Path(ambiente): Path<String>,
    headers: HeaderMap,
    corpo: Bytes,
) -> StatusCode {
    let Some(verif) = &s.services.verificacao else {
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
    let (sig, ts) = (header("x-signature"), header("x-timestamp"));

    let segredo = match verif.webhook_secret(a).await {
        Ok(Some(s)) => s,
        _ => return StatusCode::UNAUTHORIZED,
    };
    if clarituz_infrastructure::integrations::didit::verificar_assinatura(
        &segredo, &sig, &ts, &corpo,
    )
    .is_err()
    {
        return StatusCode::UNAUTHORIZED;
    }

    let Ok(payload) = serde_json::from_slice::<serde_json::Value>(&corpo) else {
        return StatusCode::BAD_REQUEST;
    };
    match verif.webhook_receber(&payload).await {
        Ok(
            ResultadoWebhook::Processado
            | ResultadoWebhook::Duplicado
            | ResultadoWebhook::SessaoDesconhecida,
        ) => StatusCode::OK,
        Err(e) => {
            tracing::warn!(erro = %e, "didit webhook: processamento falhou");
            StatusCode::INTERNAL_SERVER_ERROR
        }
    }
}
