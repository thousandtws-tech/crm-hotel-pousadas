//! Value objects validados na fronteira — construção impossível em estado inválido.

use crate::error::DomainError;
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use std::fmt;

/// CPF brasileiro com checksum (módulo 11) validado na construção.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Cpf(String);

impl Cpf {
    pub fn new(raw: &str) -> Result<Self, DomainError> {
        let digits: Vec<u32> = raw
            .chars()
            .filter(char::is_ascii_digit)
            .map(|c| c.to_digit(10).unwrap_or(0))
            .collect();

        if digits.len() != 11 {
            return Err(DomainError::validacao("CPF deve conter 11 dígitos."));
        }
        if digits.iter().all(|&d| d == digits[0]) {
            return Err(DomainError::validacao("CPF inválido."));
        }

        let dv = |slice: &[u32]| -> u32 {
            let soma: u32 = slice
                .iter()
                .enumerate()
                .map(|(i, d)| d * (slice.len() as u32 + 1 - i as u32))
                .sum();
            let r = (soma * 10) % 11;
            if r == 10 {
                0
            } else {
                r
            }
        };

        if dv(&digits[..9]) != digits[9] || dv(&digits[..10]) != digits[10] {
            return Err(DomainError::validacao("CPF inválido."));
        }

        Ok(Self(digits.iter().map(ToString::to_string).collect()))
    }

    /// Apenas dígitos — forma canônica persistida.
    pub fn digits(&self) -> &str {
        &self.0
    }

    /// `000.000.000-00`
    pub fn formatted(&self) -> String {
        let d = &self.0;
        format!("{}.{}.{}-{}", &d[..3], &d[3..6], &d[6..9], &d[9..])
    }
}

impl fmt::Display for Cpf {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl Serialize for Cpf {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for Cpf {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(d)?;
        Self::new(&raw).map_err(serde::de::Error::custom)
    }
}

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

/// E-mail normalizado (lowercase) com validação estrutural mínima.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Email(String);

impl Email {
    pub fn new(raw: &str) -> Result<Self, DomainError> {
        let e = raw.trim().to_lowercase();
        let valido = e.len() <= 254
            && e.matches('@').count() == 1
            && e.split('@').all(|p| !p.is_empty())
            && e.split('@').nth(1).is_some_and(|dom| dom.contains('.'));
        if !valido {
            return Err(DomainError::validacao("E-mail inválido."));
        }
        Ok(Self(e))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for Email {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cpf_valido() {
        assert!(Cpf::new("529.982.247-25").is_ok());
        assert!(Cpf::new("52998224725").is_ok());
    }

    #[test]
    fn cpf_invalido() {
        assert!(Cpf::new("111.111.111-11").is_err());
        assert!(Cpf::new("529.982.247-24").is_err());
        assert!(Cpf::new("123").is_err());
    }

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

    #[test]
    fn email() {
        assert!(Email::new("a@b.com").is_ok());
        assert!(Email::new("invalido").is_err());
        assert_eq!(Email::new(" A@B.COM ").unwrap().as_str(), "a@b.com");
    }
}
