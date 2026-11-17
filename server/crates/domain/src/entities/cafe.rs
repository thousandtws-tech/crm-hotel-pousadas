use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct CafePresenca {
    pub id: i64,
    pub idreserva: i64,
    pub data: NaiveDate,
    pub quantidade: i32,
    pub registrado_por: Option<i64>,
    pub criado_em: DateTime<Utc>,
    pub atualizado_em: DateTime<Utc>,
    pub version: i64,
}
