//! Tesouraria: contas a pagar/receber, fluxo de caixa, DRE, conciliação
//! bancária e split payment IBS/CBS.

use crate::error::ApiError as AppError;
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::Json;
use chrono::NaiveDate;
use clarituz_application::actor::Ator;
use clarituz_application::dto::{
    AtivoInput, BaixaInput, ClassificarExtratoInput, ConciliarInput, ContaFinanceiraInput,
    ImportacaoExtratoResponse, ImportarExtratoInput, LancamentoInput, Mensagem, PeriodoQuery,
    PlanoContaInput, TributoConfigInput,
};
use clarituz_domain::entities::{
    BaixaLancamento, Conciliacao, ContaFinanceira, Lancamento, PlanoConta, TributoApuracao,
    TributoConfig,
};
use clarituz_domain::enums::{StatusExtrato, StatusLancamento, TipoLancamento};
use clarituz_domain::ports::{FiltroExtrato, FiltroLancamento, NovoExtratoItem};
use clarituz_domain::queries::{
    BaixaView, ConciliacaoResumo, Dre, ExtratoView, FluxoCaixa, LancamentoView, SplitEventoView,
    SplitResumo, SugestaoConciliacao,
};
use clarituz_shared::{Page, PageParams};
use rust_decimal::Decimal;
use serde::Deserialize;
use serde::Serialize;

// ---------------------------------------------------------------------------
// plano de contas
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct PlanoContaQuery {
    pub todas: Option<bool>,
    pub tipo: Option<TipoLancamento>,
}

pub async fn listar_plano_contas(
    State(s): State<AppState>,
    _ator: Ator,
    Query(q): Query<PlanoContaQuery>,
) -> Result<Json<Vec<PlanoConta>>, AppError> {
    Ok(Json(
        s.services
            .tesouraria
            .listar_plano_contas(!q.todas.unwrap_or(false), q.tipo)
            .await?,
    ))
}

pub async fn criar_plano_conta(
    State(s): State<AppState>,
    ator: Ator,
    Json(input): Json<PlanoContaInput>,
) -> Result<Json<PlanoConta>, AppError> {
    Ok(Json(
        s.services
            .tesouraria
            .criar_plano_conta(&ator, input)
            .await?,
    ))
}

pub async fn atualizar_plano_conta(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(input): Json<PlanoContaInput>,
) -> Result<Json<PlanoConta>, AppError> {
    Ok(Json(
        s.services
            .tesouraria
            .atualizar_plano_conta(&ator, id, input)
            .await?,
    ))
}

pub async fn status_plano_conta(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(input): Json<AtivoInput>,
) -> Result<Json<PlanoConta>, AppError> {
    Ok(Json(
        s.services
            .tesouraria
            .status_plano_conta(&ator, id, input.ativo)
            .await?,
    ))
}

pub async fn remover_plano_conta(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<Mensagem>, AppError> {
    s.services.tesouraria.remover_plano_conta(&ator, id).await?;
    Ok(Json(Mensagem::ok("Conta removida.")))
}

// ---------------------------------------------------------------------------
// contas financeiras
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct ContaQuery {
    pub todas: Option<bool>,
}

pub async fn listar_contas(
    State(s): State<AppState>,
    _ator: Ator,
    Query(q): Query<ContaQuery>,
) -> Result<Json<Vec<ContaFinanceira>>, AppError> {
    Ok(Json(
        s.services
            .tesouraria
            .listar_contas(!q.todas.unwrap_or(false))
            .await?,
    ))
}

pub async fn criar_conta(
    State(s): State<AppState>,
    ator: Ator,
    Json(input): Json<ContaFinanceiraInput>,
) -> Result<Json<ContaFinanceira>, AppError> {
    Ok(Json(s.services.tesouraria.criar_conta(&ator, input).await?))
}

pub async fn atualizar_conta(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(input): Json<ContaFinanceiraInput>,
) -> Result<Json<ContaFinanceira>, AppError> {
    Ok(Json(
        s.services
            .tesouraria
            .atualizar_conta(&ator, id, input)
            .await?,
    ))
}

pub async fn status_conta(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(input): Json<AtivoInput>,
) -> Result<Json<ContaFinanceira>, AppError> {
    Ok(Json(
        s.services
            .tesouraria
            .status_conta(&ator, id, input.ativo)
            .await?,
    ))
}

#[derive(Debug, Serialize)]
pub struct SaldoResponse {
    pub saldo: Decimal,
}

pub async fn saldo_conta(
    State(s): State<AppState>,
    _ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<SaldoResponse>, AppError> {
    Ok(Json(SaldoResponse {
        saldo: s.services.tesouraria.saldo_conta(id).await?,
    }))
}

// ---------------------------------------------------------------------------
// lançamentos (contas a pagar/receber)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct LancamentosQuery {
    #[serde(flatten)]
    pub page: PageParams,
    pub tipo: Option<TipoLancamento>,
    pub status: Option<StatusLancamento>,
    pub vencidos: Option<bool>,
    pub inicio: Option<NaiveDate>,
    pub fim: Option<NaiveDate>,
    pub idplano_conta: Option<i64>,
    pub busca: Option<String>,
}

pub async fn listar_lancamentos(
    State(s): State<AppState>,
    _ator: Ator,
    Query(q): Query<LancamentosQuery>,
) -> Result<Json<Page<LancamentoView>>, AppError> {
    let filtro = FiltroLancamento {
        tipo: q.tipo,
        status: q.status,
        vencidos: q.vencidos.unwrap_or(false),
        inicio: q.inicio,
        fim: q.fim,
        idplano_conta: q.idplano_conta,
        busca: q.busca,
    };
    Ok(Json(
        s.services
            .tesouraria
            .listar_lancamentos(filtro, q.page)
            .await?,
    ))
}

pub async fn criar_lancamento(
    State(s): State<AppState>,
    ator: Ator,
    Json(input): Json<LancamentoInput>,
) -> Result<Json<Vec<Lancamento>>, AppError> {
    Ok(Json(
        s.services.tesouraria.criar_lancamento(&ator, input).await?,
    ))
}

pub async fn buscar_lancamento(
    State(s): State<AppState>,
    _ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<Lancamento>, AppError> {
    Ok(Json(s.services.tesouraria.buscar_lancamento(id).await?))
}

pub async fn atualizar_lancamento(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(input): Json<LancamentoInput>,
) -> Result<Json<Lancamento>, AppError> {
    Ok(Json(
        s.services
            .tesouraria
            .atualizar_lancamento(&ator, id, input)
            .await?,
    ))
}

pub async fn cancelar_lancamento(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<Lancamento>, AppError> {
    Ok(Json(
        s.services.tesouraria.cancelar_lancamento(&ator, id).await?,
    ))
}

pub async fn remover_lancamento(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<Mensagem>, AppError> {
    s.services.tesouraria.remover_lancamento(&ator, id).await?;
    Ok(Json(Mensagem::ok("Lançamento removido.")))
}

// ---------------------------------------------------------------------------
// baixas
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct BaixaResponse {
    pub baixa: BaixaLancamento,
    pub lancamento: Lancamento,
}

pub async fn baixar(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(input): Json<BaixaInput>,
) -> Result<Json<BaixaResponse>, AppError> {
    let (baixa, lancamento) = s.services.tesouraria.baixar(&ator, id, input).await?;
    Ok(Json(BaixaResponse { baixa, lancamento }))
}

pub async fn listar_baixas(
    State(s): State<AppState>,
    _ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<Vec<BaixaView>>, AppError> {
    Ok(Json(s.services.tesouraria.listar_baixas(id).await?))
}

// ---------------------------------------------------------------------------
// fluxo de caixa / DRE
// ---------------------------------------------------------------------------

pub async fn fluxo_caixa(
    State(s): State<AppState>,
    _ator: Ator,
    Query(q): Query<PeriodoQuery>,
) -> Result<Json<FluxoCaixa>, AppError> {
    Ok(Json(
        s.services.tesouraria.fluxo_caixa(q.inicio, q.fim).await?,
    ))
}

pub async fn dre(
    State(s): State<AppState>,
    _ator: Ator,
    Query(q): Query<PeriodoQuery>,
) -> Result<Json<Dre>, AppError> {
    Ok(Json(s.services.tesouraria.dre(q.inicio, q.fim).await?))
}

// ---------------------------------------------------------------------------
// extrato bancário / conciliação
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct ExtratoQuery {
    #[serde(flatten)]
    pub page: PageParams,
    pub idconta_financeira: Option<i64>,
    pub status: Option<StatusExtrato>,
    pub inicio: Option<NaiveDate>,
    pub fim: Option<NaiveDate>,
}

pub async fn listar_extrato(
    State(s): State<AppState>,
    _ator: Ator,
    Query(q): Query<ExtratoQuery>,
) -> Result<Json<Page<ExtratoView>>, AppError> {
    let filtro = FiltroExtrato {
        idconta_financeira: q.idconta_financeira,
        status: q.status,
        inicio: q.inicio,
        fim: q.fim,
    };
    Ok(Json(
        s.services.tesouraria.listar_extrato(filtro, q.page).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct ResumoExtratoQuery {
    pub idconta_financeira: Option<i64>,
}

pub async fn resumo_extrato(
    State(s): State<AppState>,
    _ator: Ator,
    Query(q): Query<ResumoExtratoQuery>,
) -> Result<Json<ConciliacaoResumo>, AppError> {
    Ok(Json(
        s.services
            .tesouraria
            .resumo_extrato(q.idconta_financeira)
            .await?,
    ))
}

pub async fn importar_extrato(
    State(s): State<AppState>,
    ator: Ator,
    Json(input): Json<ImportarExtratoInput>,
) -> Result<Json<ImportacaoExtratoResponse>, AppError> {
    // parse aqui — a API é quem enxerga a infraestrutura (ofx.rs)
    let transacoes = clarituz_infrastructure::ofx::parse_extrato(&input.conteudo)?;
    let origem = if input.conteudo.contains("OFXHEADER") || input.conteudo.contains("<OFX>") {
        "ofx"
    } else {
        "csv"
    };
    let itens: Vec<NovoExtratoItem> = transacoes
        .into_iter()
        .map(|t| NovoExtratoItem {
            idconta_financeira: input.idconta_financeira,
            data: t.data,
            descricao: t.descricao,
            documento: t.documento,
            valor: t.valor,
            fit_id: Some(t.fit_id),
            origem: origem.into(),
        })
        .collect();
    let r = s.services.tesouraria.importar_extrato(&ator, itens).await?;
    Ok(Json(ImportacaoExtratoResponse {
        importados: r.importados,
        duplicados: r.duplicados,
    }))
}

pub async fn ignorar_extrato(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<Mensagem>, AppError> {
    s.services.tesouraria.ignorar_extrato(&ator, id).await?;
    Ok(Json(Mensagem::ok("Item ignorado.")))
}

pub async fn sugestoes_extrato(
    State(s): State<AppState>,
    _ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<Vec<SugestaoConciliacao>>, AppError> {
    Ok(Json(s.services.tesouraria.sugestoes_extrato(id).await?))
}

pub async fn conciliar(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(input): Json<ConciliarInput>,
) -> Result<Json<Conciliacao>, AppError> {
    Ok(Json(
        s.services
            .tesouraria
            .conciliar(&ator, id, input.idbaixa)
            .await?,
    ))
}

pub async fn desconciliar(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<Mensagem>, AppError> {
    s.services.tesouraria.desconciliar(&ator, id).await?;
    Ok(Json(Mensagem::ok("Conciliação desfeita.")))
}

#[derive(Debug, Serialize)]
pub struct AutoConciliarResponse {
    pub conciliados: u64,
}

pub async fn auto_conciliar(
    State(s): State<AppState>,
    ator: Ator,
    Path(idconta): Path<i64>,
) -> Result<Json<AutoConciliarResponse>, AppError> {
    let n = s.services.tesouraria.auto_conciliar(&ator, idconta).await?;
    Ok(Json(AutoConciliarResponse { conciliados: n }))
}

pub async fn classificar_extrato(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(input): Json<ClassificarExtratoInput>,
) -> Result<Json<Lancamento>, AppError> {
    Ok(Json(
        s.services
            .tesouraria
            .classificar_extrato(&ator, id, input)
            .await?,
    ))
}

// ---------------------------------------------------------------------------
// tributos / split payment IBS-CBS
// ---------------------------------------------------------------------------

pub async fn tributo_config(
    State(s): State<AppState>,
    _ator: Ator,
) -> Result<Json<Option<TributoConfig>>, AppError> {
    Ok(Json(s.services.tesouraria.tributo_config().await?))
}

pub async fn listar_tributo_configs(
    State(s): State<AppState>,
    _ator: Ator,
) -> Result<Json<Vec<TributoConfig>>, AppError> {
    Ok(Json(s.services.tesouraria.listar_tributo_configs().await?))
}

pub async fn criar_tributo_config(
    State(s): State<AppState>,
    ator: Ator,
    Json(input): Json<TributoConfigInput>,
) -> Result<Json<TributoConfig>, AppError> {
    Ok(Json(
        s.services
            .tesouraria
            .criar_tributo_config(&ator, input)
            .await?,
    ))
}

pub async fn split_resumo(
    State(s): State<AppState>,
    _ator: Ator,
    Query(q): Query<PeriodoQuery>,
) -> Result<Json<SplitResumo>, AppError> {
    Ok(Json(
        s.services.tesouraria.split_resumo(q.inicio, q.fim).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct SplitEventosQuery {
    #[serde(flatten)]
    pub page: PageParams,
    pub inicio: Option<NaiveDate>,
    pub fim: Option<NaiveDate>,
}

pub async fn split_eventos(
    State(s): State<AppState>,
    _ator: Ator,
    Query(q): Query<SplitEventosQuery>,
) -> Result<Json<Page<SplitEventoView>>, AppError> {
    Ok(Json(
        s.services
            .tesouraria
            .split_eventos(q.inicio, q.fim, q.page)
            .await?,
    ))
}

pub async fn listar_apuracoes(
    State(s): State<AppState>,
    _ator: Ator,
) -> Result<Json<Vec<TributoApuracao>>, AppError> {
    Ok(Json(s.services.tesouraria.listar_apuracoes().await?))
}

#[derive(Debug, Deserialize)]
pub struct RecolherInput {
    /// Mês de competência (qualquer dia do mês serve).
    pub competencia: NaiveDate,
}

pub async fn recolher_apuracao(
    State(s): State<AppState>,
    ator: Ator,
    Json(input): Json<RecolherInput>,
) -> Result<Json<TributoApuracao>, AppError> {
    Ok(Json(
        s.services
            .tesouraria
            .recolher_apuracao(&ator, input.competencia)
            .await?,
    ))
}
