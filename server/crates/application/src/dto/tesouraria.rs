use super::de::{de_decimal, de_decimal_opt};
use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct PlanoContaInput {
    pub codigo: String,
    pub nome: String,
    pub tipo: clarituz_domain::enums::TipoLancamento,
    pub grupo_dre: clarituz_domain::enums::GrupoDre,

    pub version: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct ContaFinanceiraInput {
    pub nome: String,
    pub tipo: clarituz_domain::enums::TipoContaFinanceira,
    pub banco: Option<String>,
    pub agencia: Option<String>,
    pub conta: Option<String>,
    #[serde(default, deserialize_with = "de_decimal_opt")]
    pub saldo_inicial: Option<Decimal>,
    pub saldo_inicial_em: Option<NaiveDate>,
    pub version: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct LancamentoInput {
    pub tipo: clarituz_domain::enums::TipoLancamento,
    pub descricao: String,
    pub idplano_conta: Option<i64>,
    pub idconta_financeira: Option<i64>,
    pub favorecido: Option<String>,
    pub documento: Option<String>,
    pub idcliente: Option<i64>,
    pub idreserva: Option<i64>,
    #[serde(deserialize_with = "de_decimal")]
    pub valor: Decimal,
    pub parcelas: Option<i32>,
    pub emissao: Option<NaiveDate>,
    pub vencimento: NaiveDate,
    pub competencia: Option<NaiveDate>,
    pub observacao: Option<String>,
    pub version: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct BaixaInput {
    pub idconta_financeira: i64,
    #[serde(deserialize_with = "de_decimal")]
    pub valor: Decimal,
    pub data: Option<NaiveDate>,
    pub idforma_pagamento: Option<i64>,
    pub observacao: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ImportarExtratoInput {
    pub idconta_financeira: i64,
    pub conteudo: String,
}

#[derive(Debug, Serialize)]
pub struct ImportacaoExtratoResponse {
    pub importados: i64,
    pub duplicados: i64,
}

#[derive(Debug, Deserialize)]
pub struct ConciliarInput {
    pub idbaixa: i64,
}

#[derive(Debug, Deserialize)]
pub struct ClassificarExtratoInput {
    pub idplano_conta: i64,
    pub descricao: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct TributoConfigInput {
    #[serde(deserialize_with = "de_decimal")]
    pub aliq_ibs: Decimal,
    #[serde(deserialize_with = "de_decimal")]
    pub aliq_cbs: Decimal,
    pub regime: Option<String>,
    pub vigente_desde: Option<NaiveDate>,
}
