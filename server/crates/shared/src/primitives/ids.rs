//! Identificadores opacos baratos — sufixos únicos sem dependência externa.

use std::time::{SystemTime, UNIX_EPOCH};

/// Hex de `nanos_desde_epoch` + `pid` — usado em chaves de storage e no
/// sufixo do CPF sintético de clientes vindos do site. Não é criptográfico
/// nem UUID; apenas único o suficiente para nomes internos.
pub fn simples() -> String {
    let t = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos());
    format!("{t:x}{:x}", std::process::id())
}
