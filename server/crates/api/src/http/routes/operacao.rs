//! Operação — manutenção/PMOC, governança/lavanderia/enxoval, escalas/CLT.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use chrono::{DateTime, NaiveDate, Utc};
use clarituz_application::dto::{
    AtribuirTarefaInput, DevolverLoteInput, JornadaInput, NovaOrdemInput, NovaPmocInput,
    NovaTarefaInput, NovoLoteInput, NovoMovEnxovalInput, StatusManutInput, StatusTarefaInput,
};
use clarituz_application::Ator;
use clarituz_domain::entities::CltCorrecao;
use serde::Deserialize;

use crate::http::error::ApiError as AppError;
use crate::http::state::AppState;

// ---------------------------------------------------------------------------
// manutenção
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct OrdensQuery {
    status: Option<clarituz_domain::enums::StatusManut>,
}

pub async fn ordens_listar(
    State(s): State<AppState>,
    _ator: Ator,
    Query(q): Query<OrdensQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(serde_json::json!(
        s.services.manutencao.ordens(q.status).await?
    )))
}

pub async fn ordem_criar(
    State(s): State<AppState>,
    ator: Ator,
    Json(input): Json<NovaOrdemInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(serde_json::json!(
        s.services.manutencao.criar_ordem(&ator, input).await?
    )))
}

pub async fn ordem_status(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(input): Json<StatusManutInput>,
) -> Result<StatusCode, AppError> {
    s.services
        .manutencao
        .mudar_status(&ator, id, input.status, input.custo_centavos)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn pmoc_listar(
    State(s): State<AppState>,
    ator: Ator,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(serde_json::json!(
        s.services.manutencao.pmoc_listar(&ator).await?
    )))
}

pub async fn pmoc_registrar(
    State(s): State<AppState>,
    ator: Ator,
    Json(input): Json<NovaPmocInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(serde_json::json!(
        s.services.manutencao.pmoc_registrar(&ator, input).await?
    )))
}

/// Itens oficiais do checklist — frontend monta o formulário a partir deles.
pub async fn pmoc_itens() -> Json<serde_json::Value> {
    Json(serde_json::json!(
        clarituz_application::services::manutencao::PMOC_ITENS
    ))
}

// ---------------------------------------------------------------------------
// governança
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct DataQuery {
    data: Option<NaiveDate>,
}

pub async fn gov_quadro(
    State(s): State<AppState>,
    _ator: Ator,
    Query(q): Query<DataQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(serde_json::json!(
        s.services.governanca.quadro(q.data).await?
    )))
}

pub async fn gov_criar(
    State(s): State<AppState>,
    ator: Ator,
    Json(input): Json<NovaTarefaInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(serde_json::json!(
        s.services.governanca.criar(&ator, input).await?
    )))
}

pub async fn gov_status(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(input): Json<StatusTarefaInput>,
) -> Result<StatusCode, AppError> {
    s.services
        .governanca
        .mudar_status(&ator, id, input.status)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn gov_atribuir(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(input): Json<AtribuirTarefaInput>,
) -> Result<StatusCode, AppError> {
    s.services
        .governanca
        .atribuir(&ator, id, input.idfuncionario)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn gov_previsao(
    State(s): State<AppState>,
    _ator: Ator,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(s.services.governanca.previsao().await?))
}

/// Dispara a geração D-1 manualmente (o cron roda às 22:00 UTC).
pub async fn gov_gerar_d1(
    State(s): State<AppState>,
    ator: Ator,
) -> Result<Json<serde_json::Value>, AppError> {
    ator.exigir_gerencial()?;
    Ok(Json(serde_json::json!({
        "criadas": s.services.governanca.gerar_d1().await?
    })))
}

// ---------------------------------------------------------------------------
// lavanderia
// ---------------------------------------------------------------------------

pub async fn lav_lotes(
    State(s): State<AppState>,
    _ator: Ator,
    Query(q): Query<DataQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(serde_json::json!(
        s.services.governanca.lotes(q.data).await?
    )))
}

pub async fn lav_abrir(
    State(s): State<AppState>,
    ator: Ator,
    Json(input): Json<NovoLoteInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(serde_json::json!(
        s.services.governanca.abrir_lote(&ator, input).await?
    )))
}

pub async fn lav_devolver(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(input): Json<DevolverLoteInput>,
) -> Result<StatusCode, AppError> {
    s.services
        .governanca
        .devolver_lote(&ator, id, input.qtd_devolvida, input.custo_centavos)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
pub struct FecharMesInput {
    pub competencia: NaiveDate,
}

pub async fn lav_fechar(
    State(s): State<AppState>,
    ator: Ator,
    Json(input): Json<FecharMesInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(serde_json::json!({
        "idlancamento": s.services.governanca.fechar_mes(&ator, input.competencia).await?
    })))
}

pub async fn enxoval_saldo(
    State(s): State<AppState>,
    _ator: Ator,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(serde_json::json!(
        s.services.governanca.enxoval_saldo().await?
    )))
}

pub async fn enxoval_movs(
    State(s): State<AppState>,
    _ator: Ator,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(serde_json::json!(
        s.services.governanca.enxoval_mov().await?
    )))
}

pub async fn enxoval_registrar(
    State(s): State<AppState>,
    ator: Ator,
    Json(input): Json<NovoMovEnxovalInput>,
) -> Result<StatusCode, AppError> {
    s.services
        .governanca
        .enxoval_registrar(&ator, input)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// escalas & CLT
// ---------------------------------------------------------------------------

pub async fn jornadas_listar(
    State(s): State<AppState>,
    _ator: Ator,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(serde_json::json!(
        s.services.escalas.jornadas().await?
    )))
}

#[derive(Debug, Deserialize)]
pub struct JornadaQuery {
    dias: Option<i64>,
}

pub async fn jornada_gravar(
    State(s): State<AppState>,
    ator: Ator,
    Query(q): Query<JornadaQuery>,
    Json(input): Json<JornadaInput>,
) -> Result<StatusCode, AppError> {
    s.services
        .escalas
        .gravar_jornada(&ator, input, q.dias.unwrap_or(30))
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
pub struct TurnosQuery {
    inicio: Option<NaiveDate>,
    fim: Option<NaiveDate>,
    idfuncionario: Option<i64>,
}

pub async fn turnos_listar(
    State(s): State<AppState>,
    _ator: Ator,
    Query(q): Query<TurnosQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let hoje = chrono::Utc::now().date_naive();
    Ok(Json(serde_json::json!(
        s.services
            .escalas
            .turnos(
                q.inicio.unwrap_or(hoje),
                q.fim.unwrap_or(hoje + chrono::Duration::days(14)),
                q.idfuncionario,
            )
            .await?
    )))
}

pub async fn turno_remover(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
) -> Result<StatusCode, AppError> {
    s.services.escalas.remover_turno(&ator, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
pub struct TurnoEditar {
    inicio: DateTime<Utc>,
    fim: DateTime<Utc>,
    almoco_min: i16,
}

/// Edição inline do turno — frontend envia início/fim completos.
pub async fn turno_editar(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(b): Json<TurnoEditar>,
) -> Result<StatusCode, AppError> {
    s.services
        .escalas
        .editar_turno(&ator, id, b.inicio, b.fim, b.almoco_min)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn clt_validar(
    State(s): State<AppState>,
    ator: Ator,
    Query(q): Query<JornadaQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(serde_json::json!(
        s.services
            .escalas
            .validar(&ator, q.dias.unwrap_or(14))
            .await?
    )))
}

/// Aplica a correção sugerida pela validação — 1 clique no frontend.
pub async fn clt_corrigir(
    State(s): State<AppState>,
    ator: Ator,
    Json(correcao): Json<CltCorrecao>,
) -> Result<StatusCode, AppError> {
    s.services
        .escalas
        .aplicar_correcao(&ator, &correcao)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
