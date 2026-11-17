use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::Serialize;
use sqlx::FromRow;

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct ContratoCorporativo {
    pub id: i64,
    pub empresa: String,
    pub codigo: String,
    pub desconto_pct: Decimal,
    pub vigente_de: NaiveDate,
    pub vigente_ate: NaiveDate,
    pub contato: Option<String>,
    pub email: Option<String>,
    pub ativo: bool,
    pub notas: Option<String>,
    pub criado_em: DateTime<Utc>,
    pub atualizado_em: DateTime<Utc>,
}

impl ContratoCorporativo {
    pub fn vigente(&self, hoje: NaiveDate) -> bool {
        self.ativo && hoje >= self.vigente_de && hoje <= self.vigente_ate
    }
}
