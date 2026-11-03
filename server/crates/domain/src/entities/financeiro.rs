//! Entidades do módulo financeiro (tesouraria).
//!
//! `lancamento` + `baixa_lancamento` são o coração: o lançamento expressa a
//! obrigação (competência → DRE), a baixa expressa o evento de caixa
//! (data → fluxo de caixa → conciliação).

use crate::enums::{
    GrupoDre, StatusExtrato, StatusLancamento, StatusSplit, TipoContaFinanceira, TipoLancamento,
};
use chrono::{DateTime, NaiveDate, Utc};
use clarituz_shared::money;
use rust_decimal::Decimal;
use serde::Serialize;
use sqlx::FromRow;

/// Conta do plano de contas — classifica lançamentos e alimenta o DRE.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct PlanoConta {
    pub id: i64,
    pub codigo: String,
    pub nome: String,
    pub tipo: TipoLancamento,
    pub grupo_dre: GrupoDre,
    pub ativo: bool,
    /// Contas do seed não podem ser excluídas (integridade histórica).
    pub sistema: bool,
    pub version: i64,
    pub criado_em: DateTime<Utc>,
    pub atualizado_em: DateTime<Utc>,
}

/// Conta financeira — caixa físico, conta bancária ou aplicação.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct ContaFinanceira {
    pub id: i64,
    pub nome: String,
    pub tipo: TipoContaFinanceira,
    pub banco: Option<String>,
    pub agencia: Option<String>,
    pub conta: Option<String>,
    pub saldo_inicial: Decimal,
    pub saldo_inicial_em: NaiveDate,
    pub ativo: bool,
    pub version: i64,
    pub criado_em: DateTime<Utc>,
    pub atualizado_em: DateTime<Utc>,
}

/// Título a pagar/receber. `valor_liquidado` é mantido pelas baixas —
/// o status deriva de (valor, valor_liquidado), nunca é escrito à mão.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct Lancamento {
    pub id: i64,
    pub tipo: TipoLancamento,
    pub descricao: String,
    pub idplano_conta: Option<i64>,
    pub idconta_financeira: Option<i64>,
    pub favorecido: Option<String>,
    pub documento: Option<String>,
    pub idcliente: Option<i64>,
    pub idreserva: Option<i64>,
    pub valor: Decimal,
    pub valor_liquidado: Decimal,
    pub emissao: NaiveDate,
    pub vencimento: NaiveDate,
    /// Data que ancora o regime de competência no DRE.
    pub competencia: Option<NaiveDate>,
    pub status: StatusLancamento,
    pub observacao: Option<String>,
    pub idfuncionario: Option<i64>,
    pub version: i64,
    pub criado_em: DateTime<Utc>,
    pub atualizado_em: DateTime<Utc>,
}

impl Lancamento {
    /// Saldo ainda em aberto.
    pub fn saldo_aberto(&self) -> Decimal {
        (self.valor - self.valor_liquidado).max(Decimal::ZERO)
    }
}

/// Evento de caixa — cada quitação (total ou parcial) de um lançamento.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct BaixaLancamento {
    pub id: i64,
    pub idlancamento: i64,
    pub idconta_financeira: i64,
    pub valor: Decimal,
    pub data: NaiveDate,
    pub idforma_pagamento: Option<i64>,
    pub observacao: Option<String>,
    pub idfuncionario: Option<i64>,
    pub criado_em: DateTime<Utc>,
}

/// Linha de extrato importada (OFX/CSV). `valor` com sinal: +crédito/-débito.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct ExtratoItem {
    pub id: i64,
    pub idconta_financeira: i64,
    pub data: NaiveDate,
    pub descricao: String,
    pub documento: Option<String>,
    pub valor: Decimal,
    /// Chave de deduplicação do extrato (FITID do OFX ou hash de conteúdo).
    pub fit_id: Option<String>,
    pub origem: String,
    pub status: StatusExtrato,
    pub idbaixa: Option<i64>,
    pub importado_em: DateTime<Utc>,
}

/// Match registrado entre linha de extrato e baixa.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct Conciliacao {
    pub id: i64,
    pub idextrato_item: i64,
    pub idbaixa: i64,
    /// 0–100: exato=100, próximo=score decaído, manual=100.
    pub score: Decimal,
    pub tipo: String,
    pub idfuncionario: Option<i64>,
    pub criado_em: DateTime<Utc>,
}

/// Alíquotas IBS/CBS vigentes a partir de uma data (Reforma Tributária).
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct TributoConfig {
    pub id: i64,
    /// Alíquota do IBS (% — ex.: 0.1 = 0,1%).
    pub aliq_ibs: Decimal,
    /// Alíquota da CBS (% — ex.: 0.9 = 0,9%).
    pub aliq_cbs: Decimal,
    /// 'split' = segregação automática · 'destaque' = só apuração.
    pub regime: String,
    pub vigente_desde: NaiveDate,
    pub idfuncionario: Option<i64>,
    pub criado_em: DateTime<Utc>,
}

/// Tributo segregado por evento de caixa (split payment).
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct SplitPayment {
    pub id: i64,
    /// 'consumo' → consumo.id · 'baixa' → baixa_lancamento.id
    pub origem: String,
    pub idorigem: i64,
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

/// Fechamento mensal da apuração IBS/CBS.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct TributoApuracao {
    pub id: i64,
    pub competencia: NaiveDate,
    pub valor_ibs: Decimal,
    pub valor_cbs: Decimal,
    pub status: String,
    pub recolhido_em: DateTime<Utc>,
    pub idfuncionario: Option<i64>,
    pub criado_em: DateTime<Utc>,
}

// ---------------------------------------------------------------------------
// cálculo puro do split — determinístico, testável, usado no provisionamento
// ---------------------------------------------------------------------------

/// Resultado do split de um evento de caixa.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SplitValor {
    pub ibs: Decimal,
    pub cbs: Decimal,
    /// Valor que efetivamente fica com o estabelecimento.
    pub liquido: Decimal,
}

/// Aplica as alíquotas (em %) sobre a base e devolve o split.
/// Arredondamento half-up em 2 casas — convenção bancária BR.
pub fn calcular_split(base: Decimal, aliq_ibs: Decimal, aliq_cbs: Decimal) -> SplitValor {
    let cem = Decimal::from(100);
    let ibs = money::round2(base * aliq_ibs / cem);
    let cbs = money::round2(base * aliq_cbs / cem);
    SplitValor {
        ibs,
        cbs,
        liquido: money::round2(base) - ibs - cbs,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    #[test]
    fn split_simples() {
        // 2026 piloto: IBS 0,1% + CBS 0,9%
        let s = calcular_split(dec!(1000.00), dec!(0.1), dec!(0.9));
        assert_eq!(s.ibs, dec!(1.00));
        assert_eq!(s.cbs, dec!(9.00));
        assert_eq!(s.liquido, dec!(990.00));
    }

    #[test]
    fn split_arredonda_half_up() {
        // 0,9% de 105,55 = 0,94995 → 0,95 (meio para longe de zero)
        let s = calcular_split(dec!(105.55), dec!(0.1), dec!(0.9));
        assert_eq!(s.cbs, dec!(0.95));
        assert_eq!(s.ibs, dec!(0.11));
        assert_eq!(s.liquido, dec!(104.49));
    }

    #[test]
    fn split_aliquota_zero() {
        let s = calcular_split(dec!(250.00), dec!(0), dec!(0));
        assert_eq!(s.ibs, Decimal::ZERO);
        assert_eq!(s.cbs, Decimal::ZERO);
        assert_eq!(s.liquido, dec!(250.00));
    }
}
