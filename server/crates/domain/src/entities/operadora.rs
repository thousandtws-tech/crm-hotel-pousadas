//! Operadoras e consolidadoras B2B — parceiros que compram na tarifa net
//! e revendem. `token_extranet` autentica o acesso do parceiro à extranet
//! (consulta de disponibilidade e criação de reserva), sem JWT de
//! funcionário. `comissao_pct` desconta a diária balcão → preço net.

use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::Serialize;
use sqlx::FromRow;

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct Operadora {
    pub id: i64,
    pub nome: String,
    pub contato: Option<String>,
    pub email: Option<String>,
    pub telefone: Option<String>,
    /// % de desconto sobre a tarifa balcão → diária net do parceiro.
    pub comissao_pct: Decimal,
    /// Token opaco da extranet — rotação pelo admin invalida o anterior.
    #[serde(skip_serializing)]
    pub token_extranet: String,
    pub ativa: bool,
    pub notas: Option<String>,
    pub criado_em: DateTime<Utc>,
    pub atualizado_em: DateTime<Utc>,
}
