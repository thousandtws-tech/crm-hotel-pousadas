use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "caixa_turno_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum StatusTurno {
    Aberto,
    Fechado,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "caixa_mov_tipo", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum TipoMovimentoCaixa {
    Sangria,
    Suprimento,
}
