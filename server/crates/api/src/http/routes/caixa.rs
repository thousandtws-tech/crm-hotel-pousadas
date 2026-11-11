use crate::http::error::ApiError as AppError;
use crate::http::state::AppState;
use axum::extract::{Path, Query, State};
use axum::Json;
use chrono::NaiveDate;
use clarituz_application::actor::Ator;
use clarituz_application::dto::{AbrirCaixaInput, FecharCaixaInput, MovCaixaInput};
use clarituz_domain::entities::{CaixaMovimento, CaixaTurno};
use clarituz_domain::enums::StatusTurno;
use clarituz_domain::ports::FiltroTurno;
use clarituz_domain::queries::{ConferenciaCaixa, MovimentoCaixaView, TurnoView};
use clarituz_shared::{Page, PageParams};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct TurnoAbertoQuery {
    pub idconta_financeira: i64,
}

pub async fn turno_aberto(
    State(s): State<AppState>,
    _ator: Ator,
    Query(q): Query<TurnoAbertoQuery>,
) -> Result<Json<Option<CaixaTurno>>, AppError> {
    Ok(Json(
        s.services.caixa.turno_aberto(q.idconta_financeira).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct TurnosQuery {
    #[serde(flatten)]
    pub page: PageParams,
    pub idconta_financeira: Option<i64>,
    pub status: Option<StatusTurno>,
    pub idoperador: Option<i64>,
    pub inicio: Option<NaiveDate>,
    pub fim: Option<NaiveDate>,
}

pub async fn listar_turnos(
    State(s): State<AppState>,
    _ator: Ator,
    Query(q): Query<TurnosQuery>,
) -> Result<Json<Page<TurnoView>>, AppError> {
    let filtro = FiltroTurno {
        idconta_financeira: q.idconta_financeira,
        status: q.status,
        idoperador: q.idoperador,
        inicio: q.inicio,
        fim: q.fim,
    };
    Ok(Json(s.services.caixa.listar_turnos(filtro, q.page).await?))
}

pub async fn abrir(
    State(s): State<AppState>,
    ator: Ator,
    Json(input): Json<AbrirCaixaInput>,
) -> Result<Json<CaixaTurno>, AppError> {
    Ok(Json(s.services.caixa.abrir(&ator, input).await?))
}

pub async fn buscar_turno(
    State(s): State<AppState>,
    _ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<TurnoView>, AppError> {
    Ok(Json(s.services.caixa.buscar_turno(id).await?))
}

pub async fn conferir(
    State(s): State<AppState>,
    _ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<ConferenciaCaixa>, AppError> {
    Ok(Json(s.services.caixa.conferir(id).await?))
}

pub async fn listar_movimentos(
    State(s): State<AppState>,
    _ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<Vec<MovimentoCaixaView>>, AppError> {
    Ok(Json(s.services.caixa.listar_movimentos(id).await?))
}

pub async fn movimentar(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(input): Json<MovCaixaInput>,
) -> Result<Json<CaixaMovimento>, AppError> {
    Ok(Json(s.services.caixa.movimentar(&ator, id, input).await?))
}

pub async fn fechar(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(input): Json<FecharCaixaInput>,
) -> Result<Json<CaixaTurno>, AppError> {
    Ok(Json(s.services.caixa.fechar(&ator, id, input).await?))
}
