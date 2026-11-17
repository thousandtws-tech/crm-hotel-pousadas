use serde::Serialize;
use sqlx::FromRow;

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct ItemBusca {
    pub tipo: String,
    pub id: i64,
    pub titulo: String,
    pub sub: Option<String>,
    pub rota: String,
}
