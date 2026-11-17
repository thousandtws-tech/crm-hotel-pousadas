use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::Value as JsonValue;
use sqlx::FromRow;

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct RegistroLog {
    pub id: i64,
    pub idfuncionario: Option<i64>,
    pub funcionario_nome: Option<String>,
    pub acao: String,
    pub obs: Option<String>,
    pub tabela: Option<String>,
    pub idtabela: Option<i64>,
    pub dados: Option<JsonValue>,
    pub criado_em: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct NovoLog {
    pub idfuncionario: Option<i64>,
    pub acao: String,
    pub obs: String,
    pub tabela: &'static str,
    pub idtabela: i64,
    pub dados: Option<JsonValue>,
}
