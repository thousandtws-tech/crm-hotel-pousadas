use super::de::de_decimal_opt;
use rust_decimal::Decimal;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct AcomodacaoInput {
    pub idtipo_acomodacao: Option<i64>,
    pub nome: String,
    pub numero: i32,
    #[serde(default, deserialize_with = "de_decimal_opt")]
    pub valor: Option<Decimal>,
    pub capacidade: i32,
    pub descricao: Option<String>,
    pub cor: Option<String>,
    pub version: Option<i64>,
    pub andar: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct QuartoInput {
    pub numero: String,
}
