use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "lancamento_tipo", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum TipoLancamento {
    Pagar,
    Receber,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "lancamento_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum StatusLancamento {
    Aberto,
    Parcial,
    Liquidado,
    Cancelado,
}

impl StatusLancamento {
    pub fn liquido_aberto(&self) -> bool {
        matches!(self, Self::Aberto | Self::Parcial)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "conta_financeira_tipo", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum TipoContaFinanceira {
    Caixa,
    Banco,
    Aplicacao,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "extrato_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum StatusExtrato {
    Pendente,
    Conciliado,
    Ignorado,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "split_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum StatusSplit {
    Provisionado,
    Segregado,
    Recolhido,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "dre_grupo", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum GrupoDre {
    ReceitaBruta,
    Deducoes,
    Custos,
    DespesasOperacionais,
    ResultadoFinanceiro,
    Outras,
}
