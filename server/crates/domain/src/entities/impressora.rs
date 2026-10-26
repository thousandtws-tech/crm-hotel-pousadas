//! Impressoras térmicas de rede por setor (roteamento KOT).

use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::FromRow;

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct Impressora {
    pub id: i64,
    /// Nome amigável — ex.: "Cozinha", "Churrasqueira", "Balcão".
    pub nome: String,
    /// Setor de produção — ex.: "cozinha", "bar", "caixa".
    pub setor: String,
    pub ip: String,
    pub porta: i32,
    pub ativa: bool,
    /// Impressora padrão de comprovantes/recibos (no máximo uma).
    pub padrao: bool,
    pub version: i64,
    pub criado_em: DateTime<Utc>,
}
