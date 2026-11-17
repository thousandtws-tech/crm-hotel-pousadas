use crate::entities::{CafePresenca, NovoLog};
use crate::error::DomainError;
use crate::queries::{CafeQuadroItem, PresencaView};
use async_trait::async_trait;
use chrono::NaiveDate;
use clarituz_shared::{Page, PageParams};

#[derive(Debug, Clone)]
pub struct NovaPresenca {
    pub idreserva: i64,
    pub data: NaiveDate,
    pub quantidade: i32,
}

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
    async fn quadro(&self, data: NaiveDate) -> Result<Vec<CafeQuadroItem>, DomainError>;

    async fn reserva(&self, idreserva: i64) -> Result<Option<ReservaDoCafe>, DomainError>;

    async fn registrar_presenca(
        &self,
        nova: &NovaPresenca,
        idfuncionario: i64,
        log: NovoLog,
    ) -> Result<CafePresenca, DomainError>;

    async fn remover_presenca(&self, id: i64, log: NovoLog) -> Result<(), DomainError>;

    async fn historico(
        &self,
        inicio: Option<NaiveDate>,
        fim: Option<NaiveDate>,
        page: PageParams,
    ) -> Result<Page<PresencaView>, DomainError>;
}
