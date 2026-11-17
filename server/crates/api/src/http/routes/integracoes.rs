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
use clarituz_application::dto::{HabilitacaoInput, SalvarIntegracaoInput};
use clarituz_application::services::integracoes::TesteConexaoOutput;
use clarituz_application::services::IntegracoesService;
use clarituz_domain::entities::{AmbienteIntegracao, ProvedorPagamento};
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
) -> Result<(ProvedorPagamento, AmbienteIntegracao), AppError> {
    let p = ProvedorPagamento::parse(provedor)
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
