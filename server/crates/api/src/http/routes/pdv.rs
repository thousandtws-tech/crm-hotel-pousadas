//! PDV & Comandas — mesas, comandas, itens, garçons e comissões.

use crate::http::error::ApiError as AppError;
use crate::http::state::AppState;
use axum::extract::{Path, Query, State};
use axum::Json;
use chrono::NaiveDate;
use clarituz_application::actor::Ator;
use clarituz_application::dto::{
    AbrirComandaInput, AtivoInput, CancelarItemInput, FecharComandaInput, GarcomInput,
    ItemComandaInput, NovaMesaInput, PagarComissaoInput,
};
use clarituz_domain::entities::{PdvComanda, PdvComandaItem, PdvComissao, PdvGarcom, PdvMesa};
use clarituz_domain::enums::{PdvComandaStatus, PdvComandaTipo};
use clarituz_domain::ports::{FiltroComanda, FiltroComissao};
use clarituz_domain::queries::{
    ComandaItemView, ComandaView, ComissaoResumo, ComissaoView, FilaItemView, GarcomView,
    ItemVendaView, MesaView,
};
use clarituz_shared::{Page, PageParams};
use serde::Deserialize;

// --------------------------------------------------------------------- mesas

pub async fn listar_mesas(
    State(s): State<AppState>,
    _ator: Ator,
) -> Result<Json<Vec<MesaView>>, AppError> {
    Ok(Json(s.services.pdv.listar_mesas().await?))
}

pub async fn criar_mesa(
    State(s): State<AppState>,
    ator: Ator,
    Json(input): Json<NovaMesaInput>,
) -> Result<Json<PdvMesa>, AppError> {
    Ok(Json(s.services.pdv.criar_mesa(&ator, input).await?))
}

pub async fn status_mesa(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(input): Json<AtivoInput>,
) -> Result<Json<PdvMesa>, AppError> {
    Ok(Json(
        s.services.pdv.status_mesa(&ator, id, input.ativo).await?,
    ))
}

// -------------------------------------------------------------------- garçons

pub async fn listar_garcons(
    State(s): State<AppState>,
    _ator: Ator,
) -> Result<Json<Vec<GarcomView>>, AppError> {
    Ok(Json(s.services.pdv.listar_garcons().await?))
}

pub async fn salvar_garcom(
    State(s): State<AppState>,
    ator: Ator,
    Json(input): Json<GarcomInput>,
) -> Result<Json<PdvGarcom>, AppError> {
    Ok(Json(s.services.pdv.salvar_garcom(&ator, input).await?))
}

// ------------------------------------------------------------------- comandas

#[derive(Debug, Deserialize)]
pub struct ComandasQuery {
    #[serde(flatten)]
    pub page: PageParams,
    pub tipo: Option<PdvComandaTipo>,
    pub status: Option<PdvComandaStatus>,
    pub idgarcom: Option<i64>,
    pub inicio: Option<NaiveDate>,
    pub fim: Option<NaiveDate>,
}

pub async fn listar_comandas(
    State(s): State<AppState>,
    _ator: Ator,
    Query(q): Query<ComandasQuery>,
) -> Result<Json<Page<ComandaView>>, AppError> {
    let filtro = FiltroComanda {
        tipo: q.tipo,
        status: q.status,
        idgarcom: q.idgarcom,
        inicio: q.inicio,
        fim: q.fim,
    };
    Ok(Json(s.services.pdv.listar_comandas(filtro, q.page).await?))
}

/// GET /pdv/painel — boot do PDV em uma única chamada: mesas, comandas
/// da aba (com filtro), comandas abertas, garçons e os cadastros
/// auxiliares (itens, contas, formas, funcionários, hóspedes na casa),
/// resolvidos em paralelo no servidor. O browser faz 1 request em vez
/// de 9. Sem cache — comandas e mesas são dados vivos.
pub async fn painel_pdv(
    State(s): State<AppState>,
    _ator: Ator,
    Query(q): Query<ComandasQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let filtro = FiltroComanda {
        tipo: q.tipo,
        status: q.status,
        idgarcom: q.idgarcom,
        inicio: q.inicio,
        fim: q.fim,
    };
    let filtro_abertas = FiltroComanda {
        tipo: None,
        status: Some(PdvComandaStatus::Aberta),
        idgarcom: None,
        inicio: None,
        fim: None,
    };
    let pag = |n: u32| PageParams {
        page: 1,
        per_page: n,
    };
    let (mesas, comandas, abertas, garcons, itens, contas, formas, funcionarios, estadia) = tokio::join!(
        s.services.pdv.listar_mesas(),
        s.services.pdv.listar_comandas(filtro, q.page),
        s.services.pdv.listar_comandas(filtro_abertas, pag(50)),
        s.services.pdv.listar_garcons(),
        s.services.pdv.listar_itens_venda(None),
        s.services.tesouraria.listar_contas(true),
        s.services.pagamentos.listar(true),
        s.services.funcionarios.listar(true, pag(100)),
        s.services.reservas.listar(
            clarituz_domain::ports::FiltroReserva {
                periodo: None,
                status: Some(clarituz_domain::enums::StatusReserva::Iniciada),
                idacomodacao: None,
                idcliente: None,
                busca: None,
            },
            pag(100),
        ),
    );
    Ok(Json(serde_json::json!({
        "mesas": mesas?,
        "comandas": comandas?,
        "comandas_abertas": abertas?.items,
        "garcons": garcons?,
        "itens_venda": itens?,
        "contas": contas?,
        "formas": formas?,
        "funcionarios": funcionarios?.items,
        "reservas_estadia": estadia?.items,
    })))
}

pub async fn abrir_comanda(
    State(s): State<AppState>,
    ator: Ator,
    Json(input): Json<AbrirComandaInput>,
) -> Result<Json<PdvComanda>, AppError> {
    Ok(Json(s.services.pdv.abrir_comanda(&ator, input).await?))
}

pub async fn buscar_comanda(
    State(s): State<AppState>,
    _ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<ComandaView>, AppError> {
    Ok(Json(s.services.pdv.buscar_comanda(id).await?))
}

pub async fn listar_itens(
    State(s): State<AppState>,
    _ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<Vec<ComandaItemView>>, AppError> {
    Ok(Json(s.services.pdv.listar_itens(id).await?))
}

pub async fn adicionar_item(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(input): Json<ItemComandaInput>,
) -> Result<Json<PdvComandaItem>, AppError> {
    Ok(Json(s.services.pdv.adicionar_item(&ator, id, input).await?))
}

pub async fn entregar_item(
    State(s): State<AppState>,
    ator: Ator,
    Path((id, item)): Path<(i64, i64)>,
) -> Result<Json<PdvComandaItem>, AppError> {
    Ok(Json(s.services.pdv.entregar_item(&ator, id, item).await?))
}

pub async fn cancelar_item(
    State(s): State<AppState>,
    ator: Ator,
    Path((id, item)): Path<(i64, i64)>,
    Json(input): Json<CancelarItemInput>,
) -> Result<Json<PdvComandaItem>, AppError> {
    Ok(Json(
        s.services
            .pdv
            .cancelar_item(&ator, id, item, input.motivo)
            .await?,
    ))
}

// ---------------------------------------------------------------- KDS (cozinha)

pub async fn fila_cozinha(
    State(s): State<AppState>,
    _ator: Ator,
) -> Result<Json<Vec<FilaItemView>>, AppError> {
    Ok(Json(s.services.pdv.fila_cozinha().await?))
}

pub async fn iniciar_preparo(
    State(s): State<AppState>,
    ator: Ator,
    Path((id, item)): Path<(i64, i64)>,
) -> Result<Json<PdvComandaItem>, AppError> {
    Ok(Json(s.services.pdv.iniciar_preparo(&ator, id, item).await?))
}

pub async fn marcar_pronto(
    State(s): State<AppState>,
    ator: Ator,
    Path((id, item)): Path<(i64, i64)>,
) -> Result<Json<PdvComandaItem>, AppError> {
    Ok(Json(s.services.pdv.marcar_pronto(&ator, id, item).await?))
}

pub async fn retornar_fila(
    State(s): State<AppState>,
    ator: Ator,
    Path((id, item)): Path<(i64, i64)>,
) -> Result<Json<PdvComandaItem>, AppError> {
    Ok(Json(s.services.pdv.retornar_fila(&ator, id, item).await?))
}

pub async fn cancelar_comanda(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(input): Json<CancelarItemInput>,
) -> Result<Json<PdvComanda>, AppError> {
    Ok(Json(
        s.services
            .pdv
            .cancelar_comanda(&ator, id, input.motivo)
            .await?,
    ))
}

pub async fn fechar_comanda(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(input): Json<FecharComandaInput>,
) -> Result<Json<PdvComanda>, AppError> {
    Ok(Json(s.services.pdv.fechar_comanda(&ator, id, input).await?))
}

// ---------------------------------------------------- itens vendáveis + comissões

#[derive(Debug, Deserialize)]
pub struct ItensVendaQuery {
    pub busca: Option<String>,
}

pub async fn listar_itens_venda(
    State(s): State<AppState>,
    _ator: Ator,
    Query(q): Query<ItensVendaQuery>,
) -> Result<Json<Vec<ItemVendaView>>, AppError> {
    Ok(Json(s.services.pdv.listar_itens_venda(q.busca).await?))
}

#[derive(Debug, Deserialize)]
pub struct ComissoesQuery {
    #[serde(flatten)]
    pub page: PageParams,
    pub idgarcom: Option<i64>,
    pub apenas_pendentes: Option<bool>,
    pub inicio: Option<NaiveDate>,
    pub fim: Option<NaiveDate>,
}

pub async fn listar_comissoes(
    State(s): State<AppState>,
    _ator: Ator,
    Query(q): Query<ComissoesQuery>,
) -> Result<Json<Page<ComissaoView>>, AppError> {
    let filtro = FiltroComissao {
        idgarcom: q.idgarcom,
        apenas_pendentes: q.apenas_pendentes.unwrap_or(false),
        inicio: q.inicio,
        fim: q.fim,
    };
    Ok(Json(s.services.pdv.listar_comissoes(filtro, q.page).await?))
}

#[derive(Debug, Deserialize)]
pub struct ResumoComissoesQuery {
    pub inicio: Option<NaiveDate>,
    pub fim: Option<NaiveDate>,
}

pub async fn resumo_comissoes(
    State(s): State<AppState>,
    _ator: Ator,
    Query(q): Query<ResumoComissoesQuery>,
) -> Result<Json<Vec<ComissaoResumo>>, AppError> {
    Ok(Json(
        s.services.pdv.resumo_comissoes(q.inicio, q.fim).await?,
    ))
}

pub async fn pagar_comissao(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(input): Json<PagarComissaoInput>,
) -> Result<Json<PdvComissao>, AppError> {
    Ok(Json(s.services.pdv.pagar_comissao(&ator, id, input).await?))
}
