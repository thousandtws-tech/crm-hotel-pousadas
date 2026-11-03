//! Port da tesouraria: contas a pagar/receber, fluxo de caixa, DRE,
//! conciliação bancária e split payment IBS/CBS.
//!
//! Cada método expressa uma *operação de negócio* atômica — a implementação
//! executa a transação completa (escrita + efeitos colaterais: baixa atualiza
//! saldo do título, provisiona split e grava auditoria na mesma tx).

use crate::entities::{
    BaixaLancamento, Conciliacao, ContaFinanceira, ExtratoItem, Lancamento, NovoLog, PlanoConta,
    TributoApuracao, TributoConfig,
};
use crate::enums::{StatusExtrato, StatusLancamento, TipoLancamento};
use crate::error::DomainError;
use crate::queries::{
    BaixaView, Dre, ExtratoView, FluxoCaixa, LancamentoView, SplitEventoView, SplitResumo,
    SugestaoConciliacao,
};
use crate::value_objects::PeriodoEstadia;
use async_trait::async_trait;
use chrono::NaiveDate;
use clarituz_shared::{Page, PageParams};
use rust_decimal::Decimal;

// ---------------------------------------------------------------------------
// inputs
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct NovoPlanoConta {
    pub codigo: String,
    pub nome: String,
    pub tipo: TipoLancamento,
    pub grupo_dre: crate::enums::GrupoDre,
}

#[derive(Debug, Clone, Default)]
pub struct AtualizaPlanoConta {
    pub codigo: Option<String>,
    pub nome: Option<String>,
    pub tipo: Option<TipoLancamento>,
    pub grupo_dre: Option<crate::enums::GrupoDre>,
    /// Concorrência otimista — divergência → 409.
    pub version: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct NovaContaFinanceira {
    pub nome: String,
    pub tipo: crate::enums::TipoContaFinanceira,
    pub banco: Option<String>,
    pub agencia: Option<String>,
    pub conta: Option<String>,
    pub saldo_inicial: Decimal,
    pub saldo_inicial_em: Option<NaiveDate>,
}

#[derive(Debug, Clone, Default)]
pub struct AtualizaContaFinanceira {
    pub nome: Option<String>,
    pub tipo: Option<crate::enums::TipoContaFinanceira>,
    pub banco: Option<String>,
    pub agencia: Option<String>,
    pub conta: Option<String>,
    pub saldo_inicial: Option<Decimal>,
    pub saldo_inicial_em: Option<NaiveDate>,
    pub version: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct NovoLancamento {
    pub tipo: TipoLancamento,
    pub descricao: String,
    pub idplano_conta: Option<i64>,
    pub idconta_financeira: Option<i64>,
    pub favorecido: Option<String>,
    pub documento: Option<String>,
    pub idcliente: Option<i64>,
    pub idreserva: Option<i64>,
    pub valor: Decimal,
    pub emissao: Option<NaiveDate>,
    pub vencimento: NaiveDate,
    pub competencia: Option<NaiveDate>,
    pub observacao: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct AtualizaLancamento {
    pub descricao: Option<String>,
    pub idplano_conta: Option<i64>,
    pub idconta_financeira: Option<i64>,
    pub favorecido: Option<String>,
    pub documento: Option<String>,
    pub vencimento: Option<NaiveDate>,
    pub competencia: Option<NaiveDate>,
    pub observacao: Option<String>,
    /// Concorrência otimista — divergência → 409.
    pub version: Option<i64>,
}

#[derive(Debug, Clone, Default)]
pub struct FiltroLancamento {
    pub tipo: Option<TipoLancamento>,
    pub status: Option<StatusLancamento>,
    pub inicio: Option<NaiveDate>,
    pub fim: Option<NaiveDate>,
    /// Apenas títulos em aberto com vencimento anterior a hoje.
    pub vencidos: bool,
    pub idplano_conta: Option<i64>,
    /// Busca livre: descrição, favorecido ou documento.
    pub busca: Option<String>,
}

#[derive(Debug, Clone)]
pub struct NovaBaixa {
    pub idlancamento: i64,
    pub idconta_financeira: i64,
    pub valor: Decimal,
    pub data: Option<NaiveDate>,
    pub idforma_pagamento: Option<i64>,
    pub observacao: Option<String>,
}

#[derive(Debug, Clone)]
pub struct NovoExtratoItem {
    pub idconta_financeira: i64,
    pub data: NaiveDate,
    pub descricao: String,
    pub documento: Option<String>,
    /// Crédito positivo / débito negativo.
    pub valor: Decimal,
    pub fit_id: Option<String>,
    pub origem: String,
}

#[derive(Debug, Clone, Default)]
pub struct FiltroExtrato {
    pub idconta_financeira: Option<i64>,
    pub status: Option<StatusExtrato>,
    pub inicio: Option<NaiveDate>,
    pub fim: Option<NaiveDate>,
}

#[derive(Debug, Clone)]
pub struct NovaTributoConfig {
    pub aliq_ibs: Decimal,
    pub aliq_cbs: Decimal,
    pub regime: String,
    pub vigente_desde: Option<NaiveDate>,
}

/// Resultado da importação de extrato.
#[derive(Debug, Clone)]
pub struct ImportacaoExtrato {
    pub importados: i64,
    /// Ignorados por deduplicação (fit_id já existente na conta).
    pub duplicados: i64,
}

// ---------------------------------------------------------------------------
// port
// ---------------------------------------------------------------------------

#[async_trait]
pub trait TesourariaRepository: Send + Sync {
    // -- plano de contas -----------------------------------------------------
    async fn listar_plano_contas(
        &self,
        apenas_ativas: bool,
        tipo: Option<TipoLancamento>,
    ) -> Result<Vec<PlanoConta>, DomainError>;
    async fn criar_plano_conta(
        &self,
        novo: &NovoPlanoConta,
        log: NovoLog,
    ) -> Result<PlanoConta, DomainError>;
    async fn atualizar_plano_conta(
        &self,
        id: i64,
        dados: &AtualizaPlanoConta,
        log: NovoLog,
    ) -> Result<PlanoConta, DomainError>;
    async fn definir_plano_conta_ativa(
        &self,
        id: i64,
        ativo: bool,
        log: NovoLog,
    ) -> Result<PlanoConta, DomainError>;
    /// Remove a conta — falha (409) se `sistema` ou com lançamentos vinculados.
    async fn remover_plano_conta(&self, id: i64, log: NovoLog) -> Result<(), DomainError>;

    // -- contas financeiras --------------------------------------------------
    async fn listar_contas(&self, apenas_ativas: bool)
        -> Result<Vec<ContaFinanceira>, DomainError>;
    async fn criar_conta(
        &self,
        nova: &NovaContaFinanceira,
        log: NovoLog,
    ) -> Result<ContaFinanceira, DomainError>;
    async fn atualizar_conta(
        &self,
        id: i64,
        dados: &AtualizaContaFinanceira,
        log: NovoLog,
    ) -> Result<ContaFinanceira, DomainError>;
    async fn definir_conta_ativa(
        &self,
        id: i64,
        ativo: bool,
        log: NovoLog,
    ) -> Result<ContaFinanceira, DomainError>;
    /// Saldo real da conta até `ate` (default: hoje) — saldo_inicial + baixas.
    async fn saldo_conta(&self, id: i64, ate: Option<NaiveDate>) -> Result<Decimal, DomainError>;

    // -- lançamentos ----------------------------------------------------------
    /// Insere N lançamentos numa única transação (parcelas compartilham a tx).
    async fn criar_lancamentos(
        &self,
        novos: &[NovoLancamento],
        log: NovoLog,
    ) -> Result<Vec<Lancamento>, DomainError>;
    async fn buscar_lancamento(&self, id: i64) -> Result<Option<Lancamento>, DomainError>;
    async fn listar_lancamentos(
        &self,
        filtro: &FiltroLancamento,
        page: PageParams,
    ) -> Result<Page<LancamentoView>, DomainError>;
    async fn atualizar_lancamento(
        &self,
        id: i64,
        dados: &AtualizaLancamento,
        log: NovoLog,
    ) -> Result<Lancamento, DomainError>;
    /// Cancela título em aberto/parcial — falha (422) se já liquidado.
    async fn cancelar_lancamento(&self, id: i64, log: NovoLog) -> Result<Lancamento, DomainError>;
    /// Remove título sem baixas — falha (422) se já possuir liquidações.
    async fn remover_lancamento(&self, id: i64, log: NovoLog) -> Result<(), DomainError>;

    // -- baixas ---------------------------------------------------------------
    /// Registra uma baixa numa tx única: insere o evento, atualiza
    /// `valor_liquidado`/status do título (CHECK impede excedente) e — quando
    /// `receber` — provisiona o split IBS/CBS do recebimento.
    async fn baixar(
        &self,
        baixa: &NovaBaixa,
        idfuncionario: i64,
        log: NovoLog,
    ) -> Result<(BaixaLancamento, Lancamento), DomainError>;
    async fn listar_baixas(&self, idlancamento: i64) -> Result<Vec<BaixaView>, DomainError>;

    // -- fluxo de caixa / DRE -------------------------------------------------
    /// Série diária realizado + previsto no período (regime de caixa).
    async fn fluxo_caixa(&self, periodo: PeriodoEstadia) -> Result<FluxoCaixa, DomainError>;
    /// DRE do período — regime de competência (`lancamento.competencia`).
    async fn dre(&self, periodo: PeriodoEstadia) -> Result<Dre, DomainError>;

    // -- extrato bancário / conciliação ----------------------------------------
    /// Insere linhas de extrato — deduplicadas por `(conta, fit_id)`.
    async fn importar_extrato(
        &self,
        itens: &[NovoExtratoItem],
    ) -> Result<ImportacaoExtrato, DomainError>;
    async fn listar_extrato(
        &self,
        filtro: &FiltroExtrato,
        page: PageParams,
    ) -> Result<Page<ExtratoView>, DomainError>;
    async fn resumo_extrato(
        &self,
        idconta_financeira: Option<i64>,
    ) -> Result<crate::queries::ConciliacaoResumo, DomainError>;
    async fn buscar_extrato(&self, id: i64) -> Result<Option<ExtratoItem>, DomainError>;
    async fn ignorar_extrato(&self, id: i64, log: NovoLog) -> Result<(), DomainError>;
    /// Candidatos a match — mesmo |valor| dentro da janela de dias.
    async fn sugestoes_extrato(
        &self,
        id: i64,
        janela_dias: i64,
    ) -> Result<Vec<SugestaoConciliacao>, DomainError>;
    /// Match manual — tx: grava `conciliacao` + marca extrato.
    async fn conciliar(
        &self,
        idextrato: i64,
        idbaixa: i64,
        tipo: &str,
        score: Decimal,
        log: NovoLog,
    ) -> Result<Conciliacao, DomainError>;
    /// Desfaz um match — tx: remove `conciliacao` + reabre extrato.
    async fn desconciliar(&self, idconciliacao: i64, log: NovoLog) -> Result<(), DomainError>;
    /// Motor de match automático: pares valor+data exatos 1:1 na conta.
    async fn auto_conciliar(
        &self,
        idconta_financeira: i64,
        idfuncionario: i64,
        log: NovoLog,
    ) -> Result<u64, DomainError>;
    /// Classifica linha de extrato diretamente: cria lançamento já liquidado +
    /// baixa + conciliação numa tx (ex.: tarifa bancária, rendimento).
    async fn classificar_extrato(
        &self,
        idextrato: i64,
        idplano_conta: i64,
        descricao: Option<String>,
        idfuncionario: i64,
        log: NovoLog,
    ) -> Result<Lancamento, DomainError>;

    // -- tributos / split payment IBS-CBS --------------------------------------
    async fn tributo_config_vigente(
        &self,
        data: NaiveDate,
    ) -> Result<Option<TributoConfig>, DomainError>;
    async fn listar_tributo_configs(&self) -> Result<Vec<TributoConfig>, DomainError>;
    async fn criar_tributo_config(
        &self,
        nova: &NovaTributoConfig,
        log: NovoLog,
    ) -> Result<TributoConfig, DomainError>;
    /// Provisiona splits pendentes (self-healing): consumos concluídos e
    /// baixas de recebimento ainda sem `split_payment` — idempotente.
    async fn provisionar_splits(&self) -> Result<u64, DomainError>;
    async fn split_resumo(&self, periodo: PeriodoEstadia) -> Result<SplitResumo, DomainError>;
    async fn split_eventos(
        &self,
        periodo: PeriodoEstadia,
        page: PageParams,
    ) -> Result<Page<SplitEventoView>, DomainError>;
    async fn listar_apuracoes(&self) -> Result<Vec<TributoApuracao>, DomainError>;
    /// Fecha a apuração do mês — tx: registra `tributo_apuracao` e marca os
    /// splits provisionados/segregados da competência como `recolhido`.
    async fn recolher_apuracao(
        &self,
        competencia: NaiveDate,
        idfuncionario: i64,
        log: NovoLog,
    ) -> Result<TributoApuracao, DomainError>;
}
