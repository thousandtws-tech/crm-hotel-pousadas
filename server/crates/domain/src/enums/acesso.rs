use serde::{Deserialize, Serialize};

/// Nível de acesso do funcionário (legado: `nivel == 1` ⇒ administrador).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NivelAcesso {
    Administrador = 1,
    Gerente = 2,
    Recepcao = 3,
}

impl NivelAcesso {
    pub fn from_i16(v: i16) -> Self {
        match v {
            1 => Self::Administrador,
            2 => Self::Gerente,
            _ => Self::Recepcao,
        }
    }

    pub fn as_i16(self) -> i16 {
        self as i16
    }

    /// Administração irrestrita (funcionários, configurações, auditoria).
    pub fn is_admin(self) -> bool {
        self == Self::Administrador
    }

    /// Pode operar rotinas administrativas sensíveis (admin + gerente).
    pub fn is_gerencial(self) -> bool {
        self <= Self::Gerente
    }
}
