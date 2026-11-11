use serde::{Deserialize, Serialize};

/// Estado do turno de caixa (gaveta física por operador).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "caixa_turno_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum StatusTurno {
    /// Turno em operação — admite movimentos.
    Aberto,
    /// Conferido e encerrado — quebra já calculada.
    Fechado,
}

/// Movimento avulso de dinheiro vivo dentro do turno.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "caixa_mov_tipo", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum TipoMovimentoCaixa {
    /// Retirada de dinheiro da gaveta (ex.: depósito, pagamento urgente).
    Sangria,
    /// Entrada de dinheiro para troco/reforço.
    Suprimento,
}
