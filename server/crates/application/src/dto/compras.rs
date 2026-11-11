use super::de::de_decimal_opt;
use rust_decimal::Decimal;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct FornecedorInput {
    pub nome: String,
    pub cnpj: Option<String>,
    pub contato: Option<String>,
    pub telefone: Option<String>,
    pub lead_time_dias: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct PedidoItemInput {
    pub iditem: i64,
    pub quantidade: i32,
    #[serde(default, deserialize_with = "de_decimal_opt")]
    pub valor_unit: Option<Decimal>,
}

#[derive(Debug, Deserialize)]
pub struct PedidoCompraInput {
    pub idfornecedor: i64,
    /// "manual" | "maria" — aprovacao da sugestao da IA vem como 'maria'.
    pub origem: Option<String>,
    pub observacao: Option<String>,
    /// Vencimento da fatura; padrao = data_prevista (hoje + lead time).
    pub vencimento: Option<String>,
    #[serde(default)]
    pub gerar_pagamento: Option<bool>,
    pub itens: Vec<PedidoItemInput>,
}

#[derive(Debug, Deserialize)]
pub struct RecebimentoItemInput {
    pub iditem: i64,
    pub quantidade: i32,
}

#[derive(Debug, Deserialize)]
pub struct RecebimentoRequest {
    pub itens: Vec<RecebimentoItemInput>,
}
