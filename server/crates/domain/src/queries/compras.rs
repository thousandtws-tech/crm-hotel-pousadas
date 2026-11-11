use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::FromRow;

/// Pedido de compra com fornecedor e progresso de recebimento.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct PedidoCompraView {
    pub id: i64,
    pub idfornecedor: i64,
    pub fornecedor: String,
    pub fornecedor_cnpj: Option<String>,
    pub data_prevista: chrono::NaiveDate,
    pub valor_total: rust_decimal::Decimal,
    pub status: String,
    pub origem: String,
    pub idlancamento: Option<i64>,
    pub criado_por: Option<String>,
    pub observacao: Option<String>,
    pub total_itens: i64,
    pub recebido_itens: i64,
    pub criado_em: DateTime<Utc>,
}

/// Item do pedido de compra com nome do item de estoque.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct PedidoItemView {
    pub id: i64,
    pub iditem: i64,
    pub item: String,
    pub unidade: String,
    pub quantidade: i32,
    pub quantidade_recebida: i32,
    pub valor_unit: rust_decimal::Decimal,
}
