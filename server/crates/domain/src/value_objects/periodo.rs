use crate::error::DomainError;
use chrono::NaiveDate;

/// Período de estadia `[início, fim]` — intervalo fechado nas duas pontas,
/// semântica idêntica ao legado (`NOT (saida < ini OR entrada > fim)`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PeriodoEstadia {
    pub entrada: NaiveDate,
    pub saida: NaiveDate,
}

impl PeriodoEstadia {
    pub fn new(entrada: NaiveDate, saida: NaiveDate) -> Result<Self, DomainError> {
        if saida < entrada {
            return Err(DomainError::validacao(
                "Data de saída deve ser maior ou igual à data de entrada.",
            ));
        }
        Ok(Self { entrada, saida })
    }

    /// Dois períodos colidem quando compartilham qualquer dia (inclusive o
    /// dia de virada check-out/check-in — mesmo critério do legado).
    pub fn sobrepoe(&self, outro: &Self) -> bool {
        !(self.saida < outro.entrada || self.entrada > outro.saida)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn periodo_overlap_virada_de_dia() {
        let a = PeriodoEstadia::new(
            NaiveDate::from_ymd_opt(2026, 10, 1).unwrap(),
            NaiveDate::from_ymd_opt(2026, 10, 5).unwrap(),
        )
        .unwrap();
        let b = PeriodoEstadia::new(
            NaiveDate::from_ymd_opt(2026, 10, 5).unwrap(),
            NaiveDate::from_ymd_opt(2026, 10, 8).unwrap(),
        )
        .unwrap();
        // check-out e check-in no mesmo dia colidem (semântica do legado)
        assert!(a.sobrepoe(&b));
    }

    #[test]
    fn periodo_sem_overlap() {
        let a = PeriodoEstadia::new(
            NaiveDate::from_ymd_opt(2026, 10, 1).unwrap(),
            NaiveDate::from_ymd_opt(2026, 10, 5).unwrap(),
        )
        .unwrap();
        let b = PeriodoEstadia::new(
            NaiveDate::from_ymd_opt(2026, 10, 6).unwrap(),
            NaiveDate::from_ymd_opt(2026, 10, 8).unwrap(),
        )
        .unwrap();
        assert!(!a.sobrepoe(&b));
    }
}
