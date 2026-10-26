//! Item de resultado da busca global (read model do header).

use serde::Serialize;
use sqlx::FromRow;

/// Hit de busca — `tipo` agrupa no dropdown ("cliente", "reserva", …),
/// `sub` é o campo de desambiguação (CPF, acomodação, login…),
/// `rota` é o deep-link do Angular.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct ItemBusca {
    pub tipo: String,
    pub id: i64,
    pub titulo: String,
    pub sub: Option<String>,
    pub rota: String,
}
