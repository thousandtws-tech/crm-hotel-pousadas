use super::de::{de_decimal, de_decimal_opt};
use clarituz_domain::enums::TipoMovimento;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct ItemEstoqueInput {
    pub nome: String,
    pub idcategoria: Option<i64>,
    #[serde(default)]
    pub quantidade_inicial: Option<i32>,
    #[serde(default, deserialize_with = "de_decimal_opt")]
    pub valor_unitario: Option<Decimal>,
    pub unidade: Option<String>,
    pub estoque_minimo: Option<i32>,
    #[serde(default)]
    pub eh_insumo: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct ItemEstoqueUpdate {
    pub nome: Option<String>,
    pub idcategoria: Option<i64>,
    #[serde(default, deserialize_with = "de_decimal_opt")]
    pub valor_unitario: Option<Decimal>,
    pub unidade: Option<String>,
    pub estoque_minimo: Option<i32>,
    pub eh_insumo: Option<bool>,
    /// Concorrência otimista.
    pub version: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct MovimentacaoInput {
    pub iditem: i64,
    pub tipo: TipoMovimento,
    pub quantidade: i32,
    pub motivo: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct MovimentacoesRequest {
    pub movimentos: Vec<MovimentacaoInput>,
}
#[derive(Debug, Deserialize)]
pub struct FichaItemInput {
    pub idinsumo: i64,
    /// Quantidade do insumo (na unidade base dele) por unidade do produto.
    pub quantidade: i32,
}

#[derive(Debug, Deserialize)]
pub struct ConversaoInput {
    /// Unidade de compra (ex.: "CX", "FARDO", "KG").
    pub unidade_compra: String,
    /// Quantas unidades base equivalem 1 unidade de compra.
    pub fator: i32,
}

#[derive(Debug, Deserialize)]
pub struct NfePreviewRequest {
    /// XML completo da NF-e.
    pub xml: String,
}

/// Item da NF-e confirmado pelo usuario.
#[derive(Debug, Deserialize)]
pub struct NfeItemInput {
    /// Mapeado para item existente; `None` cria insumo novo.
    pub iditem: Option<i64>,
    pub nome: String,
    pub unidade_compra: String,
    #[serde(default)]
    pub fator: Option<i32>,
    #[serde(deserialize_with = "de_decimal")]
    pub quantidade: Decimal,
    #[serde(deserialize_with = "de_decimal")]
    pub valor_total: Decimal,
}

#[derive(Debug, Deserialize)]
pub struct NfeImportRequest {
    pub chave: String,
    pub numero: Option<String>,
    pub emitente: Option<String>,
    pub cnpj: Option<String>,
    pub emissao: Option<String>,
    #[serde(deserialize_with = "de_decimal")]
    pub total: Decimal,
    /// Vencimento da fatura a pagar (obrigatorio quando gerar_pagamento).
    pub vencimento: Option<String>,
    #[serde(default = "default_true")]
    pub gerar_pagamento: bool,
    pub itens: Vec<NfeItemInput>,
}

fn default_true() -> bool {
    true
}

/// Retorno do preview: cabecalho + itens lidos do XML.
#[derive(Debug, Serialize)]
pub struct NfePreview {
    pub chave: String,
    pub numero: Option<String>,
    pub emitente: Option<String>,
    pub cnpj: Option<String>,
    pub emissao: Option<String>,
    pub total: Decimal,
    /// `true` quando a chave ja foi importada.
    pub ja_importada: bool,
    pub itens: Vec<NfeItemPreview>,
}

#[derive(Debug, Serialize)]
pub struct NfeItemPreview {
    pub nome: String,
    pub unidade_compra: String,
    pub quantidade: Decimal,
    pub valor_unit: Decimal,
    pub valor_total: Decimal,
    /// Item de estoque com o mesmo nome, quando encontrado (sugestao de mapeamento).
    pub iditem_sugerido: Option<i64>,
    /// Fator conhecido da unidade, quando ja ha conversao cadastrada.
    pub fator_sugerido: Option<i32>,
}
