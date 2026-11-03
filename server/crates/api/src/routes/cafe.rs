//! Café da manhã — quadro diário + presença + histórico de consumo.

use axum::extract::{Path, Query, State};
use axum::Json;
use clarituz_application::dto::{HistoricoCafeQuery, QuadroCafeQuery, RegistrarPresencaInput};
use clarituz_application::Ator;
use clarituz_domain::entities::CafePresenca;
use clarituz_domain::queries::{CafeQuadroItem, PresencaView};
use clarituz_shared::Page;

use crate::error::ApiError as AppError;
use crate::state::AppState;

pub async fn quadro(
    State(s): State<AppState>,
    _ator: Ator,
    Query(q): Query<QuadroCafeQuery>,
) -> Result<Json<Vec<CafeQuadroItem>>, AppError> {
    Ok(Json(s.services.cafe.quadro(q.data).await?))
}

pub async fn registrar(
    State(s): State<AppState>,
    ator: Ator,
    Json(input): Json<RegistrarPresencaInput>,
) -> Result<Json<CafePresenca>, AppError> {
    Ok(Json(
        s.services.cafe.registrar_presenca(&ator, input).await?,
    ))
}

pub async fn remover(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<()>, AppError> {
    s.services.cafe.remover_presenca(&ator, id).await?;
    Ok(Json(()))
}

pub async fn historico(
    State(s): State<AppState>,
    _ator: Ator,
    Query(q): Query<HistoricoCafeQuery>,
) -> Result<Json<Page<PresencaView>>, AppError> {
    Ok(Json(s.services.cafe.historico(q).await?))
}
