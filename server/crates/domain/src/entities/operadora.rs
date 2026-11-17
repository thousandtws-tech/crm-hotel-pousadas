use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::Serialize;
use sqlx::FromRow;

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct Operadora {
    pub id: i64,
    pub nome: String,
    pub contato: Option<String>,
    pub email: Option<String>,
    pub telefone: Option<String>,
    pub comissao_pct: Decimal,
    #[serde(skip_serializing)]
    pub token_extranet: String,
    pub ativa: bool,
    pub notas: Option<String>,
    pub criado_em: DateTime<Utc>,
    pub atualizado_em: DateTime<Utc>,
}
