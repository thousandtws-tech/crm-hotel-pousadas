use super::de::de_decimal;
use rust_decimal::Decimal;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct AbrirCaixaInput {
    pub idconta_financeira: i64,
    #[serde(deserialize_with = "de_decimal")]
    pub saldo_inicial: Decimal,
    pub observacao: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct MovCaixaInput {
    pub tipo: clarituz_domain::enums::TipoMovimentoCaixa,
    #[serde(deserialize_with = "de_decimal")]
    pub valor: Decimal,
    pub motivo: String,
}

#[derive(Debug, Deserialize)]
pub struct FecharCaixaInput {
    /// Dinheiro contado fisicamente na gaveta.
    #[serde(deserialize_with = "de_decimal")]
    pub valor_contado: Decimal,
    pub observacao: Option<String>,
}
