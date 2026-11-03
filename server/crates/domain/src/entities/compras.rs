use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::Serialize;
use sqlx::FromRow;

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct Fornecedor {
    pub id: i64,
    pub nome: String,
    pub cnpj: Option<String>,
    pub contato: Option<String>,
    pub telefone: Option<String>,
    pub lead_time_dias: i32,
    pub ativo: bool,
    pub criado_em: DateTime<Utc>,
    pub atualizado_em: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct PedidoCompra {
    pub id: i64,
    pub idfornecedor: i64,
    pub data_prevista: NaiveDate,
    pub valor_total: Decimal,
    pub status: String,
    pub origem: String,
    pub idlancamento: Option<i64>,
    pub criado_por: Option<i64>,
    pub observacao: Option<String>,
    pub criado_em: DateTime<Utc>,
    pub atualizado_em: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct PedidoCompraItem {
    pub id: i64,
    pub idpedido: i64,
    pub iditem: i64,
    pub quantidade: i32,
    pub quantidade_recebida: i32,
    pub valor_unit: Decimal,
}
