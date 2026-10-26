//! Impressoras térmicas por setor — CRUD, teste de conectividade e
//! roteamento de categoria (KOT).

use crate::error::ApiError as AppError;
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::Json;
use clarituz_application::actor::Ator;
use clarituz_application::dto::{AtivoInput, ImpressoraCategoriaInput, ImpressoraInput};
use clarituz_domain::entities::{CategoriaEstoque, Impressora};
use serde_json::{json, Value};

pub async fn listar(
    State(s): State<AppState>,
    _ator: Ator,
) -> Result<Json<Vec<Impressora>>, AppError> {
    Ok(Json(s.services.impressoras.listar().await?))
}

pub async fn criar(
    State(s): State<AppState>,
    ator: Ator,
    Json(body): Json<ImpressoraInput>,
) -> Result<Json<Impressora>, AppError> {
    Ok(Json(s.services.impressoras.criar(&ator, body).await?))
}

pub async fn atualizar(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(body): Json<ImpressoraInput>,
) -> Result<Json<Impressora>, AppError> {
    Ok(Json(
        s.services.impressoras.atualizar(&ator, id, body).await?,
    ))
}

pub async fn status(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(body): Json<AtivoInput>,
) -> Result<Json<Value>, AppError> {
    s.services.impressoras.status(&ator, id, body.ativo).await?;
    Ok(Json(
        json!({"mensagem": "Status da impressora atualizado."}),
    ))
}

pub async fn remover(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<Value>, AppError> {
    s.services.impressoras.remover(&ator, id).await?;
    Ok(Json(json!({"mensagem": "Impressora removida."})))
}

/// Imprime um ticket de teste — valida IP/porta sem lançar consumo.
pub async fn testar(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<Value>, AppError> {
    s.services.impressoras.testar(&ator, id).await?;
    Ok(Json(json!({"mensagem": "Ticket de teste enviado."})))
}

/// Roteamento KOT: define a impressora de setor da categoria de estoque
/// (`{"impressora_id": null}` remove o destino — itens não imprimem).
pub async fn rota_categoria(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(body): Json<ImpressoraCategoriaInput>,
) -> Result<Json<CategoriaEstoque>, AppError> {
    Ok(Json(
        s.services
            .estoque
            .definir_impressora_categoria(&ator, id, body.impressora_id)
            .await?,
    ))
}
