use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use sqlx::FromRow;

/// Linha do quadro diário — reserva em estadia + presença já marcada.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct CafeQuadroItem {
    pub idreserva: i64,
    pub cliente_nome: String,
    pub quantidade_hospedes: i32,
    pub quarto_numero: Option<String>,
    pub acomodacao_nome: String,
    pub entradaprevista: NaiveDate,
    pub saidaprevista: NaiveDate,
    pub presenca_id: Option<i64>,
    pub presenca_quantidade: Option<i32>,
    pub presenca_em: Option<DateTime<Utc>>,
    pub registrado_por_nome: Option<String>,
}

/// Presença com contexto — extrato do período.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct PresencaView {
    pub id: i64,
    pub idreserva: i64,
    pub data: NaiveDate,
    pub quantidade: i32,
    pub cliente_nome: String,
    pub quarto_numero: Option<String>,
    pub registrado_por_nome: Option<String>,
    pub criado_em: DateTime<Utc>,
}
