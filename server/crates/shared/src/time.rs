//! Tempo de negócio: todas as datas operacionais respeitam `America/Sao_Paulo`.

use chrono::{DateTime, NaiveDate, Utc};
use chrono_tz::America::Sao_Paulo;

/// Data de negócio "hoje" no fuso da pousada.
pub fn hoje() -> NaiveDate {
    Utc::now().with_timezone(&Sao_Paulo).date_naive()
}

/// Instant atual em UTC.
pub fn agora() -> DateTime<Utc> {
    Utc::now()
}

/// Quantas diárias um período representa (mínimo 1 — herança do legado,
/// onde entrada e saída no mesmo dia cobram uma diária).
pub fn diarias(entrada: NaiveDate, saida: NaiveDate) -> u32 {
    let d = (saida - entrada).num_days();
    u32::try_from(d.max(1)).unwrap_or(1)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn diarias_minimo_um() {
        assert_eq!(diarias(d("2026-10-01"), d("2026-10-01")), 1);
        assert_eq!(diarias(d("2026-10-01"), d("2026-10-05")), 4);
    }
}
