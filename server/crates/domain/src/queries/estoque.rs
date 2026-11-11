use crate::enums::TipoMovimento;
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::Serialize;
use sqlx::FromRow;

/// Item do frigobar enriquecido com dados do estoque.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ItemFrigobarView {
    pub id: i64,
    pub idfrigobar: i64,
    pub iditem: i64,
    pub item_nome: String,
    pub valor_unitario: Decimal,
    pub quantidade: i32,
    pub ativo: bool,
}

/// Movimento de estoque enriquecido.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct MovimentoView {
    pub id: i64,
    pub iditem: i64,
    pub item_nome: String,
    pub tipo: TipoMovimento,
    pub quantidade: i32,
    pub funcionario: Option<String>,
    pub motivo: String,
    pub criado_em: DateTime<Utc>,
}

/// Item da ficha técnica de um produto vendável (estoque → insumos).
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct FichaItemView {
    pub id: i64,
    pub idinsumo: i64,
    pub insumo: String,
    pub unidade: String,
    pub quantidade: i32,
    pub custo_unit: rust_decimal::Decimal,
}

/// Alerta de estoque mínimo: item ativo com quantidade <= estoque_minimo.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct EstoqueBaixoView {
    pub id: i64,
    pub nome: String,
    pub unidade: String,
    pub quantidade: i32,
    pub estoque_minimo: i32,
}
