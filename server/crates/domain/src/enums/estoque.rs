use serde::{Deserialize, Serialize};

/// Direção da movimentação de estoque.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "tipo_movimento", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum TipoMovimento {
    Entrada,
    Saida,
}
