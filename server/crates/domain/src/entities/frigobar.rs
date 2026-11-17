use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::FromRow;

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct Frigobar {
    pub id: i64,
    pub idacomodacao: i64,
    pub modelo: Option<String>,
    pub patrimonio: Option<String>,
    pub ativo: bool,
    pub version: i64,
    pub criado_em: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct ItemFrigobar {
    pub id: i64,
    pub idfrigobar: i64,
    pub iditem: i64,
    pub quantidade: i32,
    pub ativo: bool,
    pub version: i64,
    pub criado_em: DateTime<Utc>,
}
