use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::FromRow;

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct Impressora {
    pub id: i64,
    pub nome: String,
    pub setor: String,
    pub ip: String,
    pub porta: i32,
    pub ativa: bool,
    pub padrao: bool,
    pub etiqueta: bool,
    pub version: i64,
    pub criado_em: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct ImpressoraDescoberta {
    pub id: i64,
    pub tipo: String,
    pub endereco: String,
    pub porta: Option<i32>,
    pub modelo: Option<String>,
    pub origem: String,
    pub status: String,
    pub impressora_id: Option<i64>,
    pub visto_em: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct ImpressaoJob {
    pub id: i64,
    pub impressora_id: Option<i64>,
    pub host: String,
    pub porta: i32,
    pub payload: Vec<u8>,
    pub modo: String,
    pub status: String,
    pub tentativas: i32,
    pub erro: Option<String>,
    pub criado_em: DateTime<Utc>,
}
