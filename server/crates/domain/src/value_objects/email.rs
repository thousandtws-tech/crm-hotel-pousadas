use crate::error::DomainError;
use std::fmt;

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
    fn email() {
        assert!(Email::new("a@b.com").is_ok());
        assert!(Email::new("invalido").is_err());
        assert_eq!(Email::new(" A@B.COM ").unwrap().as_str(), "a@b.com");
    }
}
