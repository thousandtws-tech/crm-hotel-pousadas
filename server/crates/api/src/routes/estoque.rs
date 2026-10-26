//! Estoque: categorias, itens e movimentações em lote.

use crate::error::ApiError as AppError;
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use clarituz_application::actor::Ator;
use clarituz_application::dto::{
    AtivoInput, ItemEstoqueInput, ItemEstoqueUpdate, Mensagem, MovimentacoesRequest, NomeInput,
};
use clarituz_domain::entities::{CategoriaEstoque, ItemEstoque};
use clarituz_domain::queries::MovimentoView;
use clarituz_shared::{Page, PageParams};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct AtivosPageQuery {
    #[serde(flatten)]
    pub page: PageParams,
    #[serde(default)]
    pub apenas_ativos: bool,
}

#[derive(Debug, Deserialize)]
pub struct AtivosQuery {
    #[serde(default)]
    pub apenas_ativos: bool,
}

// ---------------------------------------------------------------------------
// categorias
// ---------------------------------------------------------------------------

pub async fn listar_categorias(
    State(s): State<AppState>,
    _ator: Ator,
    Query(q): Query<AtivosQuery>,
) -> Result<Json<Vec<CategoriaEstoque>>, AppError> {
    Ok(Json(
        s.services
            .estoque
            .listar_categorias(q.apenas_ativos)
            .await?,
    ))
}

pub async fn criar_categoria(
    State(s): State<AppState>,
    ator: Ator,
    Json(body): Json<NomeInput>,
) -> Result<(StatusCode, Json<CategoriaEstoque>), AppError> {
    let c = s.services.estoque.criar_categoria(&ator, body).await?;
    Ok((StatusCode::CREATED, Json(c)))
}

pub async fn status_categoria(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(body): Json<AtivoInput>,
) -> Result<Json<CategoriaEstoque>, AppError> {
    Ok(Json(
        s.services
            .estoque
            .status_categoria(&ator, id, body.ativo)
            .await?,
    ))
}

// ---------------------------------------------------------------------------
// itens
// ---------------------------------------------------------------------------

pub async fn listar_itens(
    State(s): State<AppState>,
    _ator: Ator,
    Query(q): Query<AtivosPageQuery>,
) -> Result<Json<Page<ItemEstoque>>, AppError> {
    Ok(Json(
        s.services
            .estoque
            .listar_itens(q.apenas_ativos, q.page)
            .await?,
    ))
}

pub async fn buscar_item(
    State(s): State<AppState>,
    _ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<ItemEstoque>, AppError> {
    Ok(Json(s.services.estoque.buscar_item(id).await?))
}

pub async fn criar_item(
    State(s): State<AppState>,
    ator: Ator,
    Json(body): Json<ItemEstoqueInput>,
) -> Result<(StatusCode, Json<ItemEstoque>), AppError> {
    let i = s.services.estoque.criar_item(&ator, body).await?;
    Ok((StatusCode::CREATED, Json(i)))
}

pub async fn atualizar_item(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(body): Json<ItemEstoqueUpdate>,
) -> Result<Json<ItemEstoque>, AppError> {
    Ok(Json(
        s.services.estoque.atualizar_item(&ator, id, body).await?,
    ))
}

pub async fn status_item(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(body): Json<AtivoInput>,
) -> Result<Json<ItemEstoque>, AppError> {
    Ok(Json(
        s.services
            .estoque
            .status_item(&ator, id, body.ativo)
            .await?,
    ))
}

// ---------------------------------------------------------------------------
// movimentações
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct MovimentosQuery {
    #[serde(flatten)]
    pub page: PageParams,
    pub iditem: Option<i64>,
}

/// Entradas/saídas em lote — uma transação (`gEntrada.php`/`gSaida.php`).
pub async fn movimentar(
    State(s): State<AppState>,
    ator: Ator,
    Json(body): Json<MovimentacoesRequest>,
) -> Result<Json<Mensagem>, AppError> {
    let n = s.services.estoque.movimentar(&ator, body).await?;
    Ok(Json(Mensagem::ok(format!(
        "{n} movimentação(ões) aplicadas."
    ))))
}

pub async fn listar_movimentos(
    State(s): State<AppState>,
    _ator: Ator,
    Query(q): Query<MovimentosQuery>,
) -> Result<Json<Page<MovimentoView>>, AppError> {
    Ok(Json(
        s.services
            .estoque
            .listar_movimentos(q.iditem, q.page)
            .await?,
    ))
}
