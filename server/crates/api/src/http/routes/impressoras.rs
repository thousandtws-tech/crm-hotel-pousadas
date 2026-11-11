//! Impressoras térmicas por setor — CRUD, teste de conectividade e
//! roteamento de categoria (KOT).

use crate::http::error::ApiError as AppError;
use crate::http::state::AppState;
use axum::extract::{Path, State};
use axum::Json;
use clarituz_application::actor::Ator;
use clarituz_application::dto::{
    AtivoInput, DescobertasInput, ImpressoraCategoriaInput, ImpressoraInput,
    RegistraDescobertaInput, ResultadoJobInput,
};
use clarituz_domain::entities::{CategoriaEstoque, ImpressaoJob, Impressora, ImpressoraDescoberta};
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

/// Caixa de entrada de descobertas do agente local (rede LAN + USB).
pub async fn listar_descobertas(
    State(s): State<AppState>,
    _ator: Ator,
) -> Result<Json<Vec<ImpressoraDescoberta>>, AppError> {
    Ok(Json(s.services.impressoras.listar_descobertas().await?))
}

/// Push do agente — upsert em lote (re-reportar não duplica).
pub async fn push_descobertas(
    State(s): State<AppState>,
    ator: Ator,
    Json(body): Json<DescobertasInput>,
) -> Result<Json<Value>, AppError> {
    let n = s
        .services
        .impressoras
        .registrar_descobertas(&ator, body)
        .await?;
    Ok(Json(json!({"registradas": n})))
}

/// Confirma a descoberta → cria a impressora de setor na mesma tx.
pub async fn registrar_descoberta(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(body): Json<RegistraDescobertaInput>,
) -> Result<Json<Impressora>, AppError> {
    Ok(Json(
        s.services
            .impressoras
            .registrar_da_descoberta(&ator, id, body)
            .await?,
    ))
}

pub async fn ignorar_descoberta(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<Value>, AppError> {
    s.services.impressoras.ignorar_descoberta(&ator, id).await?;
    Ok(Json(json!({"mensagem": "Descoberta ignorada."})))
}

/// Fila do agente — próximos jobs pendentes (ESC/POS pronto, base bytea).
pub async fn jobs_pendentes(
    State(s): State<AppState>,
    _ator: Ator,
) -> Result<Json<Vec<ImpressaoJob>>, AppError> {
    Ok(Json(s.services.impressoras.jobs_pendentes().await?))
}

/// Agente reporta o resultado da entrega (sucesso ou erro com motivo).
pub async fn resultado_job(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(body): Json<ResultadoJobInput>,
) -> Result<Json<Value>, AppError> {
    s.services
        .impressoras
        .resultado_job(&ator, id, body.sucesso, body.erro.as_deref())
        .await?;
    Ok(Json(json!({"ok": true})))
}
