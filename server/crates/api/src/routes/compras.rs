//! Compras: fornecedores e pedidos de compra.

use crate::error::ApiError as AppError;
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::Json;
use clarituz_application::actor::Ator;
use clarituz_application::dto::{
    AtivoInput, FornecedorInput, Mensagem, PedidoCompraInput, RecebimentoRequest,
};
use clarituz_domain::entities::{Fornecedor, PedidoCompra, PedidoCompraItem};
use clarituz_domain::queries::{PedidoCompraView, PedidoItemView};
use clarituz_shared::{Page, PageParams};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct AtivosQuery {
    pub apenas_ativos: Option<bool>,
}

pub async fn listar_fornecedores(
    State(s): State<AppState>,
    _ator: Ator,
    Query(q): Query<AtivosQuery>,
) -> Result<Json<Vec<Fornecedor>>, AppError> {
    Ok(Json(
        s.services
            .compras
            .listar_fornecedores(q.apenas_ativos.unwrap_or(true))
            .await?,
    ))
}

pub async fn salvar_fornecedor(
    State(s): State<AppState>,
    ator: Ator,
    Json(body): Json<FornecedorInput>,
) -> Result<Json<Fornecedor>, AppError> {
    Ok(Json(
        s.services.compras.salvar_fornecedor(&ator, body).await?,
    ))
}

pub async fn status_fornecedor(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(body): Json<AtivoInput>,
) -> Result<Json<Fornecedor>, AppError> {
    Ok(Json(
        s.services
            .compras
            .status_fornecedor(&ator, id, body.ativo)
            .await?,
    ))
}

// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct PedidosQuery {
    #[serde(flatten)]
    pub page: PageParams,
    pub status: Option<String>,
}

pub async fn listar_pedidos(
    State(s): State<AppState>,
    _ator: Ator,
    Query(q): Query<PedidosQuery>,
) -> Result<Json<Page<PedidoCompraView>>, AppError> {
    Ok(Json(
        s.services
            .compras
            .listar_pedidos(q.status.as_deref(), q.page)
            .await?,
    ))
}

pub async fn buscar_pedido(
    State(s): State<AppState>,
    _ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<serde_json::Value>, AppError> {
    let (ped, itens) = s.services.compras.buscar_pedido(id).await?;
    Ok(Json(serde_json::json!({ "pedido": ped, "itens": itens })))
}

/// Aprovação (Maria) ou criação manual — tx: pedido + itens + conta a pagar.
pub async fn criar_pedido(
    State(s): State<AppState>,
    ator: Ator,
    Json(body): Json<PedidoCompraInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    let (ped, itens): (PedidoCompra, Vec<PedidoCompraItem>) =
        s.services.compras.criar_pedido(&ator, body).await?;
    Ok(Json(serde_json::json!({ "pedido": ped, "itens": itens })))
}

/// Recebimento parcial/total — entrada de estoque atômica + anti-duplicação.
pub async fn receber_pedido(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(body): Json<RecebimentoRequest>,
) -> Result<Json<PedidoCompra>, AppError> {
    Ok(Json(
        s.services.compras.receber_pedido(&ator, id, body).await?,
    ))
}

pub async fn cancelar_pedido(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<Mensagem>, AppError> {
    s.services.compras.cancelar_pedido(&ator, id).await?;
    Ok(Json(Mensagem::ok("Pedido cancelado.")))
}

// suprime aviso de tipo não usado diretamente
#[allow(dead_code)]
fn _t(_: PedidoItemView) {}
