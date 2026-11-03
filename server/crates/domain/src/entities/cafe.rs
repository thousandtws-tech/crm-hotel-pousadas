//! Café da manhã — presença de hóspedes por reserva/dia.

use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;

/// Uma linha por (reserva, dia) — `quantidade` ≤ hóspedes da reserva
/// permite presença parcial (ex.: 2 de 3 desceram para o café).
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
