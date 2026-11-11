//! Port de contratos corporativos.

use crate::entities::{ContratoCorporativo, NovoLog};
use crate::error::DomainError;
use async_trait::async_trait;
use chrono::NaiveDate;
use rust_decimal::Decimal;

#[derive(Debug, Clone, Default)]
pub struct NovoContrato {
    pub empresa: String,
    pub codigo: String,
    pub desconto_pct: Decimal,
    pub vigente_de: NaiveDate,
    pub vigente_ate: NaiveDate,
    pub contato: Option<String>,
    pub email: Option<String>,
    pub notas: Option<String>,
}

#[async_trait]
pub trait ContratoRepository: Send + Sync {
    async fn listar(&self) -> Result<Vec<ContratoCorporativo>, DomainError>;
    async fn buscar(&self, id: i64) -> Result<Option<ContratoCorporativo>, DomainError>;
    /// Resolve o código digitado no motor — case-insensitive.
    async fn por_codigo(&self, codigo: &str) -> Result<Option<ContratoCorporativo>, DomainError>;
    async fn criar(
        &self,
        novo: &NovoContrato,
        log: NovoLog,
    ) -> Result<ContratoCorporativo, DomainError>;
    async fn atualizar(
        &self,
        id: i64,
        dados: &NovoContrato,
        log: NovoLog,
    ) -> Result<Option<ContratoCorporativo>, DomainError>;
    async fn definir_ativo(
        &self,
        id: i64,
        ativo: bool,
        log: NovoLog,
    ) -> Result<Option<ContratoCorporativo>, DomainError>;
}
