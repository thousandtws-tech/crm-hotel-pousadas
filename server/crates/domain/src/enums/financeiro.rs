use serde::{Deserialize, Serialize};

/// Natureza do lançamento financeiro.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "lancamento_tipo", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum TipoLancamento {
    /// Conta a pagar (saída).
    Pagar,
    /// Conta a receber (entrada).
    Receber,
}

/// Ciclo de vida do título (contas a pagar/receber).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "lancamento_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum StatusLancamento {
    /// Em aberto — nenhuma baixa registrada.
    Aberto,
    /// Baixa parcial — ainda resta saldo.
    Parcial,
    /// Totalmente liquidado.
    Liquidado,
    /// Cancelado — não afeta caixa nem DRE.
    Cancelado,
}

impl StatusLancamento {
    /// Se ainda admite baixas (não está encerrado).
    pub fn liquido_aberto(&self) -> bool {
        matches!(self, Self::Aberto | Self::Parcial)
    }
}

/// Natureza da conta financeira (onde o dinheiro vive).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "conta_financeira_tipo", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum TipoContaFinanceira {
    /// Caixa físico (dinheiro na recepção).
    Caixa,
    /// Conta bancária — alvo da conciliação.
    Banco,
    /// Aplicação/reserva.
    Aplicacao,
}

/// Estado da linha de extrato no processo de conciliação.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "extrato_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum StatusExtrato {
    /// Importado, aguardando match.
    Pendente,
    /// Vinculado a uma baixa.
    Conciliado,
    /// Descartado da conciliação (ex.: lançamento sem contrapartida).
    Ignorado,
}

/// Ciclo do tributo segregado (split payment IBS/CBS).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "split_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum StatusSplit {
    /// Calculado, aguardando apuração.
    Provisionado,
    /// Segregado na conta de tributos.
    Segregado,
    /// Recolhido ao fisco (apuração do mês fechada).
    Recolhido,
}

/// Agrupador do DRE — determina o sinal da conta no resultado.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "dre_grupo", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum GrupoDre {
    /// Soma na receita bruta.
    ReceitaBruta,
    /// Subtrai da receita (descontos, tributos, devoluções).
    Deducoes,
    /// Subtrai após a receita líquida (CMV, comissões).
    Custos,
    /// Despesas operacionais (pessoal, utilidades, manutenção…).
    DespesasOperacionais,
    /// Juros, tarifas, rendimentos.
    ResultadoFinanceiro,
    /// Receitas/despesas não operacionais.
    Outras,
}
