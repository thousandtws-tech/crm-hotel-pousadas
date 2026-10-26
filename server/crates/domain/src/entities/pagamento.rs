//! Formas de pagamento aceitas no fechamento da conta.

use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::FromRow;

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct FormaPagamento {
    pub id: i64,
    pub nome: String,
    pub ativo: bool,
    pub version: i64,
    pub criado_em: DateTime<Utc>,
}
