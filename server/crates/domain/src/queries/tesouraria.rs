use crate::enums::{GrupoDre, StatusExtrato, StatusLancamento, StatusSplit, TipoLancamento};
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::Serialize;
use sqlx::FromRow;

/// Lançamento enriquecido para listagem (joins de apresentação).
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct LancamentoView {
    pub id: i64,
    pub tipo: TipoLancamento,
    pub descricao: String,
    pub idplano_conta: Option<i64>,
    pub plano_conta: Option<String>,
    pub grupo_dre: Option<GrupoDre>,
    pub idconta_financeira: Option<i64>,
    pub conta_financeira: Option<String>,
    pub favorecido: Option<String>,
    pub documento: Option<String>,
    pub idcliente: Option<i64>,
    pub cliente_nome: Option<String>,
    pub idreserva: Option<i64>,
    pub valor: Decimal,
    pub valor_liquidado: Decimal,
    /// Derivado no SQL: valor - valor_liquidado.
    pub saldo: Decimal,
    pub emissao: NaiveDate,
    pub vencimento: NaiveDate,
    pub competencia: Option<NaiveDate>,
    pub status: StatusLancamento,
    /// Derivado: aberto/parcial com vencimento < hoje.
    pub vencido: bool,
    pub observacao: Option<String>,
    pub version: i64,
    pub criado_em: DateTime<Utc>,
}

/// Baixa enriquecida (conta, forma de pagamento, funcionário).
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct BaixaView {
    pub id: i64,
    pub idlancamento: i64,
    pub idconta_financeira: i64,
    pub conta_financeira: Option<String>,
    pub valor: Decimal,
    pub data: NaiveDate,
    pub idforma_pagamento: Option<i64>,
    pub forma_pagamento: Option<String>,
    pub observacao: Option<String>,
    pub funcionario: Option<String>,
    pub criado_em: DateTime<Utc>,
}

/// Linha do fluxo de caixa diário — regime de caixa + projeção.
#[derive(Debug, Clone, Serialize)]
pub struct FluxoCaixaDia {
    pub data: NaiveDate,
    /// Entradas realizadas (baixas de receber + consumos fechados).
    pub entradas: Decimal,
    /// Saídas realizadas (baixas de pagar).
    pub saidas: Decimal,
    /// entradas - saidas do dia.
    pub saldo: Decimal,
    /// Saldo acumulado desde o saldo inicial.
    pub acumulado: Decimal,
    /// A receber previsto para o dia (vencimentos em aberto).
    pub prev_entradas: Decimal,
    /// A pagar previsto para o dia.
    pub prev_saidas: Decimal,
}

/// Resposta do fluxo de caixa: saldo de abertura + série diária + totais.
#[derive(Debug, Clone, Serialize)]
pub struct FluxoCaixa {
    pub inicio: NaiveDate,
    pub fim: NaiveDate,
    /// Saldo disponível na véspera do período (saldo_inicial + caixa realizado).
    pub saldo_abertura: Decimal,
    pub total_entradas: Decimal,
    pub total_saidas: Decimal,
    /// Saldo projetado ao fim (abertura + realizado + previstos).
    pub saldo_final_previsto: Decimal,
    pub dias: Vec<FluxoCaixaDia>,
}

/// Linha do DRE — uma conta do plano (ou origem operacional) e seu total.
#[derive(Debug, Clone, Serialize)]
pub struct DreLinha {
    /// 'operacional' = gerado por consumos de reserva; id da conta caso contrário.
    pub origem: String,
    pub codigo: Option<String>,
    pub rotulo: String,
    pub grupo: GrupoDre,
    pub valor: Decimal,
}

/// DRE do período — regime de competência (campo `competencia`).
#[derive(Debug, Clone, Serialize)]
pub struct Dre {
    pub inicio: NaiveDate,
    pub fim: NaiveDate,
    pub receita_bruta: Decimal,
    /// Descontos de consumo + IBS/CBS provisionado + contas de dedução.
    pub deducoes: Decimal,
    pub receita_liquida: Decimal,
    pub custos: Decimal,
    pub despesas_operacionais: Decimal,
    pub lucro_operacional: Decimal,
    /// Saldo de receitas − despesas financeiras.
    pub resultado_financeiro: Decimal,
    /// Saldo de outras receitas − despesas não operacionais.
    pub outras: Decimal,
    pub resultado_liquido: Decimal,
    /// Tributos segregados (referência — já dentro de deduções).
    pub ibs: Decimal,
    pub cbs: Decimal,
    pub linhas: Vec<DreLinha>,
}

/// Extrato enriquecido com o estado da conciliação.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ExtratoView {
    pub id: i64,
    pub idconta_financeira: i64,
    pub conta_financeira: Option<String>,
    pub data: NaiveDate,
    pub descricao: String,
    pub documento: Option<String>,
    pub valor: Decimal,
    pub fit_id: Option<String>,
    pub origem: String,
    pub status: StatusExtrato,
    pub idbaixa: Option<i64>,
    /// Score do melhor candidato pendente (pré-calculado na listagem).
    pub melhor_score: Option<Decimal>,
    pub importado_em: DateTime<Utc>,
}

/// Candidato a match para conciliação manual.
#[derive(Debug, Clone, Serialize)]
pub struct SugestaoConciliacao {
    pub baixa: BaixaView,
    /// 0–100 — decai com distância de dias e divergência de descrição.
    pub score: Decimal,
    pub dias_diferenca: i64,
    /// Lançamento de origem (descrição + tipo) para conferência visual.
    pub lancamento_descricao: String,
    pub lancamento_tipo: TipoLancamento,
}

/// Linha de extrato pronta para gerar lançamento + baixa + conciliação.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ConciliacaoResumo {
    pub pendentes: i64,
    pub conciliados: i64,
    pub ignorados: i64,
    /// Último dia importado por conta (referência de cobertura).
    pub coberto_ate: Option<NaiveDate>,
}

/// Evento de split enriquecido com a descrição da origem.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct SplitEventoView {
    pub id: i64,
    pub origem: String,
    pub idorigem: i64,
    /// Descrição amigável (reserva/lancamento) para a UI.
    pub descricao: String,
    pub base: Decimal,
    pub aliq_ibs: Decimal,
    pub aliq_cbs: Decimal,
    pub valor_ibs: Decimal,
    pub valor_cbs: Decimal,
    pub valor_liquido: Decimal,
    pub competencia: NaiveDate,
    pub status: StatusSplit,
    pub criado_em: DateTime<Utc>,
}

/// Totais de split no período.
#[derive(Debug, Clone, Serialize)]
pub struct SplitResumo {
    pub inicio: NaiveDate,
    pub fim: NaiveDate,
    pub base: Decimal,
    pub valor_ibs: Decimal,
    pub valor_cbs: Decimal,
    pub valor_liquido: Decimal,
    pub qtd_eventos: i64,
    /// Provisionado ainda não recolhido (saldo na conta de tributos).
    pub provisionado_ibs: Decimal,
    pub provisionado_cbs: Decimal,
}
