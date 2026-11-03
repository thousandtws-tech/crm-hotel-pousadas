//! Port do café da manhã — quadro diário de presença por reserva.
//!
//! Invariantes:
//! * uma linha por (reserva, dia) — UNIQUE(idreserva, data);
//! * `quantidade` entre 1 e o nº de hóspedes da reserva;
//! * a data deve cair dentro da estadia (entradaprevista..=saidaprevista);
//! * reserva cancelada não admite presença.

use crate::entities::{CafePresenca, NovoLog};
use crate::error::DomainError;
use crate::queries::{CafeQuadroItem, PresencaView};
use async_trait::async_trait;
use chrono::NaiveDate;
use clarituz_shared::{Page, PageParams};

/// Registro/ajuste de presença (upsert por reserva+dia).
#[derive(Debug, Clone)]
pub struct NovaPresenca {
    pub idreserva: i64,
    pub data: NaiveDate,
    pub quantidade: i32,
}

/// Reserva mínima para validar a presença.
#[derive(Debug, Clone)]
pub struct ReservaDoCafe {
    pub id: i64,
    pub quantidade_hospedes: i32,
    pub entradaprevista: NaiveDate,
    pub saidaprevista: NaiveDate,
    pub cancelada: bool,
}

#[async_trait]
pub trait CafeRepository: Send + Sync {
    /// Quadro do dia — reservas cuja estadia cobre `data` (pendente,
    /// iniciada ou finalizada; cancelada nunca aparece), com presença
    /// já registrada à esquerda.
    async fn quadro(&self, data: NaiveDate) -> Result<Vec<CafeQuadroItem>, DomainError>;

    /// Busca a reserva para validação (status + janela + hóspedes).
    async fn reserva(&self, idreserva: i64) -> Result<Option<ReservaDoCafe>, DomainError>;

    /// Upsert de presença — cria ou atualiza a quantidade do dia.
    async fn registrar_presenca(
        &self,
        nova: &NovaPresenca,
        idfuncionario: i64,
        log: NovoLog,
    ) -> Result<CafePresenca, DomainError>;

    /// Desmarca presença (hóspede foi embora sem consumir / lançamento errado).
    async fn remover_presenca(&self, id: i64, log: NovoLog) -> Result<(), DomainError>;

    /// Extrato de presenças por período — relatório de consumo.
    async fn historico(
        &self,
        inicio: Option<NaiveDate>,
        fim: Option<NaiveDate>,
        page: PageParams,
    ) -> Result<Page<PresencaView>, DomainError>;
}
