//! Operadoras B2B — CRUD admin + extranet do parceiro.
//!
//! Admin usa JWT (`Ator`); a extranet autentica por `X-Extranet-Token`
//! opaco (`OperadoraCtx`), resolvido via `operadoras.autenticar`.

use crate::error::ApiError as AppError;
use crate::state::AppState;
use axum::extract::{FromRequestParts, Path, Query, State};
use axum::http::request::Parts;
use axum::Json;
use chrono::NaiveDate;
use clarituz_application::actor::Ator;
use clarituz_application::services::contratos::{ContratoCodigoView, ContratoInput};
use clarituz_application::services::operadoras::{OperadoraInput, ReservaOperadoraInput};
use clarituz_domain::entities::{ContratoCorporativo, Operadora, Reserva};
use clarituz_domain::DomainError;
use serde::Deserialize;
use serde_json::{json, Value};

// ---------------------------------------------------------------------------
// Extranet — credencial do parceiro no header `X-Extranet-Token`.
// ---------------------------------------------------------------------------

pub struct OperadoraCtx(pub Operadora);

impl FromRequestParts<AppState> for OperadoraCtx {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let token = parts
            .headers
            .get("x-extranet-token")
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| DomainError::nao_autenticado("Informe o header X-Extranet-Token."))?;
        let op = state.services.operadoras.autenticar(token).await?;
        Ok(Self(op))
    }
}

// ---------------------------------------------------------------------------
// Admin — gestão das operadoras (JWT).
// ---------------------------------------------------------------------------

/// `GET /operadoras` — lista todas (token nunca serializado).
pub async fn listar(
    State(s): State<AppState>,
    ator: Ator,
) -> Result<Json<Vec<Operadora>>, AppError> {
    Ok(Json(s.services.operadoras.listar(&ator).await?))
}

/// `POST /operadoras` — cadastra e devolve `{ operadora, token }` uma vez.
pub async fn criar(
    State(s): State<AppState>,
    ator: Ator,
    Json(input): Json<OperadoraInput>,
) -> Result<Json<Value>, AppError> {
    let op = s.services.operadoras.criar(&ator, input).await?;
    let token = s.services.operadoras.token(&ator, op.id).await?;
    Ok(Json(json!({ "operadora": op, "token": token })))
}

/// `PUT /operadoras/{id}` — dados cadastrais e % de comissão.
pub async fn atualizar(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(input): Json<OperadoraInput>,
) -> Result<Json<Operadora>, AppError> {
    Ok(Json(
        s.services.operadoras.atualizar(&ator, id, input).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct AtivaInput {
    pub ativa: bool,
}

/// `PATCH /operadoras/{id}/ativa` — desativa sem apagar o histórico.
pub async fn definir_ativa(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(input): Json<AtivaInput>,
) -> Result<Json<Operadora>, AppError> {
    Ok(Json(
        s.services
            .operadoras
            .definir_ativa(&ator, id, input.ativa)
            .await?,
    ))
}

/// `GET /operadoras/{id}/token` — revela a credencial atual do parceiro.
pub async fn token(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<Value>, AppError> {
    let token = s.services.operadoras.token(&ator, id).await?;
    Ok(Json(json!({ "token": token })))
}

/// `POST /operadoras/{id}/token/rotacionar` — invalida o anterior.
pub async fn rotacionar(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<Value>, AppError> {
    let token = s.services.operadoras.rotacionar_token(&ator, id).await?;
    Ok(Json(json!({ "token": token })))
}

#[derive(Debug, Deserialize)]
pub struct FaturamentoQuery {
    pub de: NaiveDate,
    pub ate: NaiveDate,
}

/// `GET /operadoras/{id}/faturamento` — reservas do parceiro no período.
pub async fn faturamento(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Query(q): Query<FaturamentoQuery>,
) -> Result<Json<clarituz_application::services::operadoras::FaturamentoOperadora>, AppError> {
    Ok(Json(
        s.services
            .operadoras
            .faturamento(&ator, id, q.de, q.ate)
            .await?,
    ))
}

// ---------------------------------------------------------------------------
// Extranet — consumo do parceiro (X-Extranet-Token).
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct ExtranetDisponibilidadeQuery {
    pub check_in: NaiveDate,
    pub check_out: NaiveDate,
    pub hospedes: Option<i32>,
}

/// `GET /extranet/disponibilidade` — acomodações livres na tarifa net.
pub async fn extranet_disponibilidade(
    State(s): State<AppState>,
    OperadoraCtx(op): OperadoraCtx,
    Query(q): Query<ExtranetDisponibilidadeQuery>,
) -> Result<Json<clarituz_application::services::operadoras::DisponibilidadeOperadora>, AppError> {
    Ok(Json(
        s.services
            .operadoras
            .disponibilidade(&op, q.check_in, q.check_out, q.hospedes)
            .await?,
    ))
}

/// `POST /extranet/reservas` — cria reserva vinculada (faturamento B2B).
pub async fn extranet_reservar(
    State(s): State<AppState>,
    OperadoraCtx(op): OperadoraCtx,
    Json(input): Json<ReservaOperadoraInput>,
) -> Result<Json<Reserva>, AppError> {
    Ok(Json(s.services.operadoras.reservar(&op, input).await?))
}

// ---------------------------------------------------------------------------
// Contratos corporativos — desconto por código público no motor.
// ---------------------------------------------------------------------------

/// `GET /contratos` — lista (código nunca serializado).
pub async fn contratos_listar(
    State(s): State<AppState>,
    ator: Ator,
) -> Result<Json<Vec<ContratoCorporativo>>, AppError> {
    Ok(Json(s.services.contratos.listar(&ator).await?))
}

/// `POST /contratos` — cadastra empresa + código público + vigência.
pub async fn contratos_criar(
    State(s): State<AppState>,
    ator: Ator,
    Json(input): Json<ContratoInput>,
) -> Result<Json<ContratoCorporativo>, AppError> {
    Ok(Json(s.services.contratos.criar(&ator, input).await?))
}

/// `PUT /contratos/{id}` — dados e vigência do contrato.
pub async fn contratos_atualizar(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(input): Json<ContratoInput>,
) -> Result<Json<ContratoCorporativo>, AppError> {
    Ok(Json(
        s.services.contratos.atualizar(&ator, id, input).await?,
    ))
}

/// `PATCH /contratos/{id}/ativo` — desativa sem perder o histórico.
pub async fn contratos_definir_ativo(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(input): Json<AtivaInput>,
) -> Result<Json<ContratoCorporativo>, AppError> {
    Ok(Json(
        s.services
            .contratos
            .definir_ativo(&ator, id, input.ativa)
            .await?,
    ))
}

/// `GET /publico/contrato/{codigo}` — valida código no motor; inválido
/// e expirado respondem o mesmo `{valido: false}` (não vaza existência).
pub async fn publico_contrato(
    State(s): State<AppState>,
    Path(codigo): Path<String>,
) -> Result<Json<ContratoCodigoView>, AppError> {
    Ok(Json(s.services.contratos.resolver_codigo(&codigo).await?))
}
