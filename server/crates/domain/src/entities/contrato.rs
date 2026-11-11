//! Contratos corporativos — desconto negociado com empresa, aplicado
//! quando o hóspede digita o `codigo` no motor de reservas. Vigência
//! fecha a janela de validade; fora dela o código simplesmente não
//! desconta (não gera erro — o site não vaza que o contrato existe).

use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::Serialize;
use sqlx::FromRow;

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct ContratoCorporativo {
    pub id: i64,
    pub empresa: String,
    /// Código público digitado no motor (ex.: "ACME2025") — uppercase.
    /// Visível ao admin; o endpoint público usa `ContratoCodigoView`.
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
    /// Vigente hoje e ativo — regra única do desconto.
    pub fn vigente(&self, hoje: NaiveDate) -> bool {
        self.ativo && hoje >= self.vigente_de && hoje <= self.vigente_ate
    }
}
