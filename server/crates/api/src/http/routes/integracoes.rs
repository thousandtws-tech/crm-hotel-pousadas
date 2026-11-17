//! Integrações de pagamento — catálogo, configuração, teste de conexão,
//! habilitação, provedor padrão e eventos de webhook (admin-only).
//!
//! Segredos nunca saem pela API: `segredos.campos` expõe apenas o mapa
//! campo→configurado. `services.integracoes` é `None` sem
//! `INTEGRACOES_MASTER_KEY` — 503 explícito em vez de cofre improvisado.

use crate::http::error::ApiError as AppError;
use crate::http::state::AppState;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use clarituz_application::actor::Ator;
use clarituz_application::dto::{HabilitacaoInput, MensagemTesteInput, SalvarIntegracaoInput};
use clarituz_application::services::integracoes::TesteConexaoOutput;
use clarituz_application::services::IntegracoesService;
use clarituz_domain::entities::{AmbienteIntegracao, ProvedorIntegracao};
use clarituz_domain::ports::{EventoIntegracaoView, IntegracaoView};
use clarituz_domain::DomainError;
use std::sync::Arc;

fn svc(s: &AppState) -> Result<&Arc<IntegracoesService>, AppError> {
    s.services
        .integracoes
        .as_ref()
        .ok_or_else(|| DomainError::regra("Módulo de integrações não configurado.").into())
}

fn par(
    provedor: &str,
    ambiente: &str,
) -> Result<(ProvedorIntegracao, AmbienteIntegracao), AppError> {
    let p = ProvedorIntegracao::parse(provedor)
        .ok_or_else(|| DomainError::nao_encontrado("Provedor desconhecido."))?;
    let a = AmbienteIntegracao::parse(ambiente)
        .ok_or_else(|| DomainError::nao_encontrado("Ambiente desconhecido."))?;
    Ok((p, a))
}

pub async fn listar_integracoes(
    State(s): State<AppState>,
    ator: Ator,
) -> Result<Json<Vec<IntegracaoView>>, AppError> {
    Ok(Json(svc(&s)?.catalogo(&ator).await?))
}

pub async fn detalhe_integracao(
    State(s): State<AppState>,
    ator: Ator,
    Path((provedor, ambiente)): Path<(String, String)>,
) -> Result<Json<IntegracaoView>, AppError> {
    let (p, a) = par(&provedor, &ambiente)?;
    Ok(Json(svc(&s)?.detalhe(&ator, p, a).await?))
}

pub async fn salvar_integracao(
    State(s): State<AppState>,
    ator: Ator,
    Path((provedor, ambiente)): Path<(String, String)>,
    Json(input): Json<SalvarIntegracaoInput>,
) -> Result<Json<IntegracaoView>, AppError> {
    let (p, a) = par(&provedor, &ambiente)?;
    Ok(Json(svc(&s)?.salvar(&ator, p, a, input).await?))
}

pub async fn habilitacao_integracao(
    State(s): State<AppState>,
    ator: Ator,
    Path((provedor, ambiente)): Path<(String, String)>,
    Json(input): Json<HabilitacaoInput>,
) -> Result<Json<IntegracaoView>, AppError> {
    let (p, a) = par(&provedor, &ambiente)?;
    Ok(Json(svc(&s)?.habilitacao(&ator, p, a, input).await?))
}

pub async fn testar_integracao(
    State(s): State<AppState>,
    ator: Ator,
    Path((provedor, ambiente)): Path<(String, String)>,
) -> Result<Json<TesteConexaoOutput>, AppError> {
    let (p, a) = par(&provedor, &ambiente)?;
    Ok(Json(svc(&s)?.testar(&ator, p, a).await?))
}

pub async fn padrao_integracao(
    State(s): State<AppState>,
    ator: Ator,
    Path((provedor, ambiente)): Path<(String, String)>,
) -> Result<StatusCode, AppError> {
    let (p, a) = par(&provedor, &ambiente)?;
    svc(&s)?.definir_padrao(&ator, p, a).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn eventos_integracao(
    State(s): State<AppState>,
    ator: Ator,
    Path((provedor, ambiente)): Path<(String, String)>,
) -> Result<Json<Vec<EventoIntegracaoView>>, AppError> {
    let (p, a) = par(&provedor, &ambiente)?;
    Ok(Json(svc(&s)?.eventos(&ator, p, a, 50).await?))
}

// ---------------------------------------------------------------------------
// Z-API — operações da instância (admin). Todas `{ambiente}=producao`.
// ---------------------------------------------------------------------------

fn zapi_par(ambiente: &str) -> Result<AmbienteIntegracao, AppError> {
    if AmbienteIntegracao::parse(ambiente) != Some(AmbienteIntegracao::Producao) {
        return Err(DomainError::nao_encontrado("Z-API opera apenas em produção.").into());
    }
    Ok(AmbienteIntegracao::Producao)
}

/// QR Code de pareamento — imagem base64 ou fluxo assistido.
pub async fn zapi_qr(
    State(s): State<AppState>,
    ator: Ator,
    Path(ambiente): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    zapi_par(&ambiente)?;
    Ok(Json(svc(&s)?.zapi_qr(&ator).await?))
}

/// Registra os 5 callbacks na instância — URL pública com segredo.
pub async fn zapi_webhooks(
    State(s): State<AppState>,
    ator: Ator,
    Path(ambiente): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    zapi_par(&ambiente)?;
    let base = s
        .api_base
        .clone()
        .ok_or_else(|| DomainError::regra("PUBLIC_API_URL não configurada."))?;
    Ok(Json(svc(&s)?.zapi_configurar_webhooks(&ator, &base).await?))
}

/// Mensagem de teste única — destinatário explícito, sem retry.
pub async fn zapi_teste(
    State(s): State<AppState>,
    ator: Ator,
    Path(ambiente): Path<String>,
    Json(input): Json<MensagemTesteInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    zapi_par(&ambiente)?;
    Ok(Json(svc(&s)?.zapi_enviar_teste(&ator, &input).await?))
}

/// Logout remoto da sessão — ação explícita do operador.
pub async fn zapi_desconectar(
    State(s): State<AppState>,
    ator: Ator,
    Path(ambiente): Path<String>,
) -> Result<StatusCode, AppError> {
    zapi_par(&ambiente)?;
    svc(&s)?.zapi_desconectar(&ator).await?;
    Ok(StatusCode::NO_CONTENT)
}
