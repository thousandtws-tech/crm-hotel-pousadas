use serde::{Deserialize, Serialize};

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

    pub fn is_admin(self) -> bool {
        self == Self::Administrador
    }

    pub fn is_gerencial(self) -> bool {
        self <= Self::Gerente
    }
}
