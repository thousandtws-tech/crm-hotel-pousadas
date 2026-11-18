//! Dashboard, financeiro e auditoria — leituras agregadas.

use crate::http::error::ApiError as AppError;
use crate::http::state::AppState;
use axum::extract::{Query, State};
use axum::Json;
use chrono::NaiveDate;
use clarituz_application::actor::Ator;
use clarituz_application::dto::{DashboardResponse, PeriodoQuery};
use clarituz_domain::entities::RegistroLog;
use clarituz_domain::ports::FiltroLog;
use clarituz_domain::queries::{ItemMaisVendido, PontoSerie, ResumoFinanceiro, VendaItem};
use clarituz_shared::{Page, PageParams};
use serde::Deserialize;

// ---------------------------------------------------------------------------
// dashboard
// ---------------------------------------------------------------------------

pub async fn dashboard(
    State(s): State<AppState>,
    _ator: Ator,
) -> Result<Json<DashboardResponse>, AppError> {
    Ok(Json(s.services.dashboard.consolidar().await?))
}

// ---------------------------------------------------------------------------
// financeiro
// ---------------------------------------------------------------------------

pub async fn resumo_financeiro(
    State(s): State<AppState>,
    _ator: Ator,
    Query(q): Query<PeriodoQuery>,
) -> Result<Json<ResumoFinanceiro>, AppError> {
    Ok(Json(s.services.financeiro.resumo(q.inicio, q.fim).await?))
}

/// Painel consolidado da Home — as 5 leituras do período em uma única
/// chamada, resolvidas em paralelo no servidor (tokio::join). O browser
/// faz 1 request em vez de 5, e o custo total é o da query mais lenta.
pub async fn painel_financeiro(
    State(s): State<AppState>,
    _ator: Ator,
    Query(q): Query<PeriodoQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let fin = &s.services.financeiro;
    let (resumo, recebido, reservas, pagamento, acomodacao) = tokio::join!(
        fin.resumo(q.inicio, q.fim),
        fin.serie_recebido(q.inicio, q.fim),
        fin.serie_reservas(q.inicio, q.fim),
        fin.recebido_por_pagamento(q.inicio, q.fim),
        fin.lucro_por_acomodacao(q.inicio, q.fim),
    );
    Ok(Json(serde_json::json!({
        "resumo": resumo?,
        "serie_recebido": recebido?,
        "serie_reservas": reservas?,
        "serie_por_pagamento": pagamento?,
        "serie_por_acomodacao": acomodacao?,
    })))
}

pub async fn serie_recebido(
    State(s): State<AppState>,
    _ator: Ator,
    Query(q): Query<PeriodoQuery>,
) -> Result<Json<Vec<PontoSerie>>, AppError> {
    Ok(Json(
        s.services
            .financeiro
            .serie_recebido(q.inicio, q.fim)
            .await?,
    ))
}

pub async fn serie_por_pagamento(
    State(s): State<AppState>,
    _ator: Ator,
    Query(q): Query<PeriodoQuery>,
) -> Result<Json<Vec<PontoSerie>>, AppError> {
    Ok(Json(
        s.services
            .financeiro
            .recebido_por_pagamento(q.inicio, q.fim)
            .await?,
    ))
}

pub async fn serie_reservas(
    State(s): State<AppState>,
    _ator: Ator,
    Query(q): Query<PeriodoQuery>,
) -> Result<Json<Vec<PontoSerie>>, AppError> {
    Ok(Json(
        s.services
            .financeiro
            .serie_reservas(q.inicio, q.fim)
            .await?,
    ))
}

pub async fn serie_vendas(
    State(s): State<AppState>,
    _ator: Ator,
    Query(q): Query<PeriodoQuery>,
) -> Result<Json<Vec<PontoSerie>>, AppError> {
    Ok(Json(
        s.services.financeiro.serie_vendas(q.inicio, q.fim).await?,
    ))
}

pub async fn itens_mais_vendidos(
    State(s): State<AppState>,
    _ator: Ator,
    Query(q): Query<PeriodoQuery>,
) -> Result<Json<Vec<ItemMaisVendido>>, AppError> {
    Ok(Json(
        s.services
            .financeiro
            .itens_mais_vendidos(q.inicio, q.fim)
            .await?,
    ))
}

pub async fn vendas(
    State(s): State<AppState>,
    _ator: Ator,
    Query(q): Query<PeriodoQuery>,
) -> Result<Json<Vec<VendaItem>>, AppError> {
    Ok(Json(s.services.financeiro.vendas(q.inicio, q.fim).await?))
}

pub async fn lucro_por_acomodacao(
    State(s): State<AppState>,
    _ator: Ator,
    Query(q): Query<PeriodoQuery>,
) -> Result<Json<Vec<PontoSerie>>, AppError> {
    Ok(Json(
        s.services
            .financeiro
            .lucro_por_acomodacao(q.inicio, q.fim)
            .await?,
    ))
}

// ---------------------------------------------------------------------------
// auditoria (admin)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct LogsQuery {
    #[serde(flatten)]
    pub page: PageParams,
    pub tabela: Option<String>,
    pub acao: Option<String>,
    pub idfuncionario: Option<i64>,
    pub idtabela: Option<i64>,
    pub desde: Option<NaiveDate>,
    pub ate: Option<NaiveDate>,
}

pub async fn logs(
    State(s): State<AppState>,
    ator: Ator,
    Query(q): Query<LogsQuery>,
) -> Result<Json<Page<RegistroLog>>, AppError> {
    let filtro = FiltroLog {
        tabela: q.tabela,
        acao: q.acao,
        idfuncionario: q.idfuncionario,
        idtabela: q.idtabela,
        desde: q.desde,
        ate: q.ate,
    };
    Ok(Json(
        s.services.auditoria.listar(&ator, filtro, q.page).await?,
    ))
}
