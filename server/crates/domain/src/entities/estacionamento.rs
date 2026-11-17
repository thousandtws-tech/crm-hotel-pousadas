use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::FromRow;

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct VagaEstacionamento {
    pub id: i64,
    pub idacomodacao: Option<i64>,
    pub numero: String,
    pub ativo: bool,
    pub version: i64,
    pub criado_em: DateTime<Utc>,
}
