//! Port de operadoras B2B.

use crate::entities::{NovoLog, Operadora};
use crate::error::DomainError;
use async_trait::async_trait;
use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde::Serialize;
use sqlx::FromRow;

#[derive(Debug, Clone, Default)]
pub struct NovaOperadora {
    pub nome: String,
    pub cnpj: Option<String>,
    pub contato: Option<String>,
    pub email: Option<String>,
    pub telefone: Option<String>,
    pub comissao_pct: Decimal,
    pub notas: Option<String>,
}

/// Linha do faturamento segregado — reserva de uma operadora no período.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct FaturamentoLinha {
    pub idreserva: i64,
    pub hospede: String,
    pub entrada: NaiveDate,
    pub saida: NaiveDate,
    pub status: String,
    pub valor_total: Decimal,
}

#[async_trait]
pub trait OperadoraRepository: Send + Sync {
    async fn listar(&self) -> Result<Vec<Operadora>, DomainError>;
    async fn buscar(&self, id: i64) -> Result<Option<Operadora>, DomainError>;
    /// Resolve a credencial da extranet — só operadoras ativas.
    async fn por_token(&self, token: &str) -> Result<Option<Operadora>, DomainError>;
    async fn criar(
        &self,
        nova: &NovaOperadora,
        token: &str,
        log: NovoLog,
    ) -> Result<Operadora, DomainError>;
    async fn atualizar(
        &self,
        id: i64,
        dados: &NovaOperadora,
        log: NovoLog,
    ) -> Result<Option<Operadora>, DomainError>;
    async fn definir_ativa(
        &self,
        id: i64,
        ativa: bool,
        log: NovoLog,
    ) -> Result<Option<Operadora>, DomainError>;
    /// Rotação de credencial — retorna a operadora com o token novo.
    async fn rotacionar_token(
        &self,
        id: i64,
        token: &str,
        log: NovoLog,
    ) -> Result<Option<Operadora>, DomainError>;
    /// Reservas da operadora no período — faturamento segregado.
    async fn faturamento(
        &self,
        id: i64,
        de: NaiveDate,
        ate: NaiveDate,
    ) -> Result<Vec<FaturamentoLinha>, DomainError>;
}
