//! Reservas: ciclo de vida completo — criar, listar, disponibilidade,
//! calendário, check-in, check-out, cancelamento e consumo.

use crate::error::ApiError as AppError;
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use chrono::NaiveDate;
use clarituz_application::actor::Ator;
use clarituz_application::dto::{
    AcompanhanteInput, AdicionalInput, CancelamentoResponse, CancelarReservaRequest,
    CheckinRequest, CheckoutRequest, DisponibilidadeQuery, DisponibilidadeResponse,
    FnrhEmitRequest, ItemConsumidoRequest, ReservaFiltroQuery, ReservaInput,
};
use clarituz_domain::entities::{Acompanhante, AdicionalConsumo, Fnrh, ItemConsumido, Reserva};
use clarituz_domain::enums::StatusReserva;
use clarituz_domain::ports::FiltroReserva;
use clarituz_domain::queries::{ComprovanteResumo, ReservaDetalhe, ReservaResumo};
use clarituz_domain::value_objects::PeriodoEstadia;
use clarituz_domain::DomainError;
use clarituz_shared::{Page, PageParams};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Debug, Deserialize)]
pub struct ListarQuery {
    #[serde(flatten)]
    pub page: PageParams,
    #[serde(flatten)]
    pub filtro: ReservaFiltroQuery,
}

fn parse_status(s: &str) -> Result<StatusReserva, AppError> {
    match s {
        "p" | "pendente" => Ok(StatusReserva::Pendente),
        "i" | "iniciada" => Ok(StatusReserva::Iniciada),
        "c" | "cancelada" => Ok(StatusReserva::Cancelada),
        "f" | "finalizada" => Ok(StatusReserva::Finalizada),
        _ => Err(DomainError::validacao(format!("Status de reserva inválido: '{s}'.")).into()),
    }
}

fn periodo_opt(
    inicio: Option<NaiveDate>,
    fim: Option<NaiveDate>,
) -> Result<Option<PeriodoEstadia>, AppError> {
    match (inicio, fim) {
        (Some(i), Some(f)) => Ok(Some(PeriodoEstadia::new(i, f)?)),
        (None, None) => Ok(None),
        _ => Err(DomainError::validacao("Informe inicio e fim juntos.").into()),
    }
}

pub async fn listar_reservas(
    State(s): State<AppState>,
    _ator: Ator,
    Query(q): Query<ListarQuery>,
) -> Result<Json<Page<ReservaResumo>>, AppError> {
    let filtro = FiltroReserva {
        periodo: periodo_opt(q.filtro.inicio, q.filtro.fim)?,
        status: q
            .filtro
            .status
            .as_deref()
            .map(|s| parse_status(&s.to_lowercase()))
            .transpose()?,
        idacomodacao: q.filtro.idacomodacao,
        idcliente: q.filtro.idcliente,
        busca: q.filtro.busca.filter(|b| !b.trim().is_empty()),
    };
    Ok(Json(s.services.reservas.listar(filtro, q.page).await?))
}

pub async fn buscar_reserva(
    State(s): State<AppState>,
    _ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<ReservaDetalhe>, AppError> {
    Ok(Json(s.services.reservas.detalhe(id).await?))
}

pub async fn criar_reserva(
    State(s): State<AppState>,
    ator: Ator,
    Json(body): Json<ReservaInput>,
) -> Result<(StatusCode, Json<Reserva>), AppError> {
    let r = s.services.reservas.criar(&ator, body).await?;
    Ok((StatusCode::CREATED, Json(r)))
}

/// Legado: `reserva/api/disponibilidade.php`.
pub async fn disponibilidade(
    State(s): State<AppState>,
    _ator: Ator,
    Query(q): Query<DisponibilidadeQuery>,
) -> Result<Json<DisponibilidadeResponse>, AppError> {
    Ok(Json(
        s.services
            .reservas
            .disponibilidade(q.inicio, q.fim, q.idacomodacao, q.excluir_reserva)
            .await?,
    ))
}

/// Eventos do calendário — todas as reservas que intersectam o período.
#[derive(Debug, Deserialize)]
pub struct EventosQuery {
    pub inicio: Option<NaiveDate>,
    pub fim: Option<NaiveDate>,
}

pub async fn eventos(
    State(s): State<AppState>,
    _ator: Ator,
    Query(q): Query<EventosQuery>,
) -> Result<Json<Vec<ReservaResumo>>, AppError> {
    let periodo = periodo_opt(q.inicio, q.fim)?;
    Ok(Json(s.services.reservas.eventos(periodo).await?))
}

/// Check-in — `data`/`hora` opcionais (default: agora, fuso da pousada).
pub async fn checkin(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    body: Option<Json<CheckinRequest>>,
) -> Result<Json<Reserva>, AppError> {
    let req = body.map(|b| b.0).unwrap_or_default();
    Ok(Json(
        s.services
            .reservas
            .checkin(&ator, id, req.instante())
            .await?,
    ))
}

/// Check-out — devolve a reserva finalizada e a conta de consumo fechada.
pub async fn checkout(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(body): Json<CheckoutRequest>,
) -> Result<Json<Value>, AppError> {
    let (reserva, consumo) = s.services.reservas.checkout(&ator, id, body).await?;
    Ok(Json(json!({"reserva": reserva, "consumo": consumo})))
}

/// Cancelamento — reserva em estadia exige admin (direto ou via credenciais
/// `login_admin`/`senha_admin`, paridade com `aCancelarReservaAdm.php`).
pub async fn cancelar(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(body): Json<CancelarReservaRequest>,
) -> Result<Json<CancelamentoResponse>, AppError> {
    Ok(Json(s.services.reservas.cancelar(&ator, id, body).await?))
}

/// `DELETE /reservas/{id}` — exclui reserva pendente ou cancelada junto com
/// a conta de consumo (admin). Iniciadas/finalizadas → use Cancelar.
pub async fn remover_reserva(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
) -> Result<StatusCode, AppError> {
    s.services.reservas.remover(&ator, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

// --- consumo -------------------------------------------------------------

/// Venda de item do frigobar para a conta da reserva (`gItemConsumido.php`).
pub async fn registrar_item(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(body): Json<ItemConsumidoRequest>,
) -> Result<(StatusCode, Json<ItemConsumido>), AppError> {
    let item = s
        .services
        .reservas
        .registrar_item_consumido(&ator, id, body)
        .await?;
    Ok((StatusCode::CREATED, Json(item)))
}

pub async fn itens_consumidos(
    State(s): State<AppState>,
    _ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<Vec<ItemConsumido>>, AppError> {
    Ok(Json(s.services.reservas.itens_consumidos(id).await?))
}

pub async fn adicionais(
    State(s): State<AppState>,
    _ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<Vec<AdicionalConsumo>>, AppError> {
    Ok(Json(s.services.reservas.adicionais(id).await?))
}

/// Lançamento avulso na conta durante a estadia (consumo adicional).
pub async fn lancar_adicional(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(body): Json<AdicionalInput>,
) -> Result<Json<AdicionalConsumo>, AppError> {
    Ok(Json(
        s.services
            .reservas
            .lancar_adicional(&ator, id, body)
            .await?,
    ))
}

// --- comprovantes (página Pagamentos do legado) ------------------------------

pub async fn comprovantes(
    State(s): State<AppState>,
    _ator: Ator,
) -> Result<Json<Vec<ComprovanteResumo>>, AppError> {
    Ok(Json(s.services.reservas.comprovantes().await?))
}

/// Recibo gerado a partir da conta persistida — `inline` para "Visualizar";
/// o frontend força download no "Baixar" via `Content-Disposition` local.
pub async fn comprovante_texto(
    State(s): State<AppState>,
    _ator: Ator,
    Path(id): Path<i64>,
) -> Result<([(axum::http::HeaderName, String); 2], String), AppError> {
    let (nome, texto) = s.services.reservas.comprovante_texto(id).await?;
    Ok((
        [
            (
                axum::http::header::CONTENT_TYPE,
                "text/plain; charset=utf-8".to_string(),
            ),
            (
                axum::http::header::CONTENT_DISPOSITION,
                format!("inline; filename=\"{nome}\""),
            ),
        ],
        texto,
    ))
}

/// Envia o comprovante para a impressora térmica —
/// `?impressora=` força uma impressora específica; sem o parâmetro usa
/// a impressora padrão (ou o fallback legado do estabelecimento).
pub async fn imprimir_comprovante(
    State(s): State<AppState>,
    _ator: Ator,
    Path(id): Path<i64>,
    Query(q): Query<ImpressoraQuery>,
) -> Result<Json<Value>, AppError> {
    s.services
        .reservas
        .imprimir_comprovante(id, q.impressora)
        .await?;
    Ok(Json(
        json!({"mensagem": "Comprovante enviado para a impressora."}),
    ))
}

#[derive(Deserialize)]
pub struct ImpressoraQuery {
    pub impressora: Option<i64>,
}

/// Reimprime os tickets de produção (KOT) do consumo da reserva —
/// um ticket por impressora de setor com apenas os itens dela.
pub async fn imprimir_producao(
    State(s): State<AppState>,
    _ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<Value>, AppError> {
    let tickets = s.services.reservas.imprimir_producao(id).await?;
    Ok(Json(
        json!({"mensagem": format!("{tickets} ticket(s) de produção enviados."), "tickets": tickets}),
    ))
}

// ---------------------------------------------------------------------------
// acompanhantes + FNRH (registro de hóspedes)
// ---------------------------------------------------------------------------

pub async fn acompanhantes(
    State(s): State<AppState>,
    _ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<Vec<Acompanhante>>, AppError> {
    Ok(Json(s.services.reservas.listar_acompanhantes(id).await?))
}

pub async fn adicionar_acompanhante(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(body): Json<AcompanhanteInput>,
) -> Result<(StatusCode, Json<Acompanhante>), AppError> {
    let a = s
        .services
        .reservas
        .adicionar_acompanhante(&ator, id, body)
        .await?;
    Ok((StatusCode::CREATED, Json(a)))
}

pub async fn remover_acompanhante(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
) -> Result<StatusCode, AppError> {
    s.services.reservas.remover_acompanhante(&ator, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Fichas FNRH emitidas para a reserva (mais recente primeiro).
pub async fn fnrh_reserva(
    State(s): State<AppState>,
    _ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<Vec<Fnrh>>, AppError> {
    Ok(Json(s.services.reservas.listar_fnrh(id).await?))
}

/// Emite a FNRH — snapshot imutável de cliente + reserva + acompanhantes.
pub async fn emitir_fnrh(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(body): Json<FnrhEmitRequest>,
) -> Result<(StatusCode, Json<Fnrh>), AppError> {
    let f = s.services.reservas.emitir_fnrh(&ator, id, body).await?;
    Ok((StatusCode::CREATED, Json(f)))
}
