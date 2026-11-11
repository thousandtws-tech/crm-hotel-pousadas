use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct NomeInput {
    pub nome: String,
    /// Concorrência otimista — só em PUT.
    pub version: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct AtivoInput {
    pub ativo: bool,
}
#[derive(Debug, Deserialize)]
pub struct PeriodoQuery {
    pub inicio: Option<NaiveDate>,
    pub fim: Option<NaiveDate>,
}
/// Resposta padronizada para operações simples.
#[derive(Debug, Serialize)]
pub struct Mensagem {
    pub mensagem: String,
}

impl Mensagem {
    pub fn ok(m: impl Into<String>) -> Self {
        Self { mensagem: m.into() }
    }
}
