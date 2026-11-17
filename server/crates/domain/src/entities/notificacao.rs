use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::Value as JsonValue;
use sqlx::FromRow;

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct Notificacao {
    pub id: i64,
    pub tipo: String,
    pub titulo: String,
    pub mensagem: String,
    pub autor_nome: Option<String>,
    pub dados: Option<JsonValue>,
    #[sqlx(default)]
    pub lida: bool,
    pub criado_em: DateTime<Utc>,
}
