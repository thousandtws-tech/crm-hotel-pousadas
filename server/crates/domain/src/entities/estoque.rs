use crate::enums::TipoMovimento;
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::Serialize;
use sqlx::FromRow;

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct CategoriaEstoque {
    pub id: i64,
    pub nome: String,
    pub impressora_id: Option<i64>,
    pub ativo: bool,
    pub version: i64,
    pub criado_em: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct ItemEstoque {
    pub id: i64,
    pub nome: String,
    pub idcategoria: Option<i64>,
    pub quantidade: i32,
    pub valor_unitario: Decimal,
    pub ativo: bool,
    pub version: i64,
    pub criado_em: DateTime<Utc>,
    pub atualizado_em: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct MovimentoEstoque {
    pub id: i64,
    pub iditem: i64,
    pub tipo: TipoMovimento,
    pub quantidade: i32,
    pub idfuncionario: Option<i64>,
    pub motivo: String,
    pub criado_em: DateTime<Utc>,
}
