use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use sqlx::FromRow;

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct ClienteDocumento {
    pub id: i64,
    pub idcliente: i64,
    pub tipo: String,
    pub numero: String,
    pub orgao_emissor: Option<String>,
    pub uf_emissor: Option<String>,
    pub pais_emissor: Option<String>,
    pub validade: Option<NaiveDate>,
    pub tem_scan: bool,
    pub version: i64,
    pub criado_em: DateTime<Utc>,
    pub atualizado_em: DateTime<Utc>,
}
