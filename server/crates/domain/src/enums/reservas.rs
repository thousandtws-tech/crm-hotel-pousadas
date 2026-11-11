use serde::{Deserialize, Serialize};

/// Ciclo de vida da reserva (legado: char `p`/`i`/`c`/`f`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "reserva_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum StatusReserva {
    /// Reserva criada, aguardando check-in.
    #[sqlx(rename = "p")]
    #[serde(rename = "p")]
    Pendente,
    /// Check-in realizado — hóspede na casa.
    #[sqlx(rename = "i")]
    #[serde(rename = "i")]
    Iniciada,
    /// Cancelada (libera a acomodação).
    #[sqlx(rename = "c")]
    #[serde(rename = "c")]
    Cancelada,
    /// Check-out realizado — ciclo encerrado.
    #[sqlx(rename = "f")]
    #[serde(rename = "f")]
    Finalizada,
}

impl StatusReserva {
    /// Status que ainda ocupam a acomodação (usado pela constraint de overlap).
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

/// Ciclo de vida da conta de consumo vinculada a uma reserva.
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
