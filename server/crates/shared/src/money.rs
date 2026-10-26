//! Dinheiro: `Decimal` com escala fixa de 2 casas (BRL). Nunca `f64`.

use rust_decimal::prelude::Zero;
use rust_decimal::{Decimal, RoundingStrategy};

/// Arredonda para 2 casas (half-up, convenção bancária BR).
/// `round_dp` puro usa half-to-even — aqui queremos meio-para-longe-de-zero.
pub fn round2(v: Decimal) -> Decimal {
    v.round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero)
}

/// Soma monetária segura de uma lista de valores.
pub fn sum<'a>(it: impl Iterator<Item = &'a Decimal>) -> Decimal {
    it.fold(Decimal::zero(), |acc, v| acc + round2(*v))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    #[test]
    fn round2_half_up() {
        assert_eq!(round2(dec!(10.005)), dec!(10.01));
        assert_eq!(round2(dec!(10.004)), dec!(10.00));
    }
}
