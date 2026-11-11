use super::de::{de_decimal, de_decimal_opt};
use rust_decimal::Decimal;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct NovaMesaInput {
    pub numero: String,
    pub lugares: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct GarcomInput {
    pub idfuncionario: i64,
    #[serde(deserialize_with = "de_decimal")]
    pub percentual: Decimal,
    pub ativo: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct AbrirComandaInput {
    pub tipo: clarituz_domain::enums::PdvComandaTipo,
    pub idmesa: Option<i64>,
    pub idquarto: Option<i64>,
    pub idcliente: Option<i64>,
    pub idgarcom: Option<i64>,
    /// Rótulo livre — obrigatório no tipo `balcao`.
    pub rotulo: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ItemComandaInput {
    pub iditem: i64,
    pub quantidade: i32,
}

#[derive(Debug, Deserialize)]
pub struct CancelarItemInput {
    pub motivo: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct FecharComandaInput {
    /// 'pagar' = à vista (baixa imediata) · 'faturar' = fica em aberto no quarto.
    pub modo: String,
    #[serde(default, deserialize_with = "de_decimal_opt")]
    pub desconto: Option<Decimal>,
    pub idconta_financeira: Option<i64>,
    pub idforma_pagamento: Option<i64>,
    pub observacao: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct PagarComissaoInput {
    pub idconta_financeira: i64,
    pub idforma_pagamento: Option<i64>,
}
