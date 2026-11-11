use chrono::NaiveDate;
use serde::Serialize;
use sqlx::FromRow;

/// Cards do dashboard (equivalente a `home/include/dadosCard.php`).
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct DashboardCards {
    pub total_acomodacoes: i64,
    pub acomodacoes_disponiveis: i64,
    pub acomodacoes_ocupadas: i64,
    pub hospedes_atuais: i64,
    pub checkins_hoje: i64,
    pub checkouts_hoje: i64,
    pub checkins_pendentes_hoje: i64,
    pub checkouts_pendentes_hoje: i64,
}

/// Check-in/check-out pendente de hoje (home).
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct PendenciaDia {
    pub idreserva: i64,
    pub acomodacao_nome: String,
    pub cliente_nome: String,
    pub entradaprevista: NaiveDate,
    pub saidaprevista: NaiveDate,
}
