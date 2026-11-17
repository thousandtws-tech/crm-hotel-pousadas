use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "reserva_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum StatusReserva {
    #[sqlx(rename = "p")]
    #[serde(rename = "p")]
    Pendente,
    #[sqlx(rename = "i")]
    #[serde(rename = "i")]
    Iniciada,
    #[sqlx(rename = "c")]
    #[serde(rename = "c")]
    Cancelada,
    #[sqlx(rename = "f")]
    #[serde(rename = "f")]
    Finalizada,
}

impl StatusReserva {
    pub const OCUPANTES: &'static [Self] = &[Self::Pendente, Self::Iniciada];

    pub fn ocupa(&self) -> bool {
        matches!(self, Self::Pendente | Self::Iniciada)
    }

    pub fn permite_checkin(&self) -> bool {
        *self == Self::Pendente
    }

    pub fn permite_checkout(&self) -> bool {
        *self == Self::Iniciada
    }

    pub fn permite_cancelamento(&self) -> bool {
        matches!(self, Self::Pendente | Self::Iniciada)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "consumo_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum StatusConsumo {
    Pendente,
    Concluido,
    Cancelado,
    Reembolsado,
}

impl StatusConsumo {
    pub fn aberto(&self) -> bool {
        *self == Self::Pendente
    }
}
