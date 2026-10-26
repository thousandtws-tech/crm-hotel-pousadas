//! Ports de suporte: auditoria, dashboard e financeiro.

use crate::entities::{NovoLog, RegistroLog};
use crate::error::DomainError;
use crate::queries::{
    DashboardCards, ItemMaisVendido, PendenciaDia, PontoSerie, ReservaResumo, ResumoFinanceiro,
    VendaItem,
};
use crate::value_objects::PeriodoEstadia;
use async_trait::async_trait;
use chrono::NaiveDate;
use clarituz_shared::{Page, PageParams};

#[derive(Debug, Clone, Default)]
pub struct FiltroLog {
    pub tabela: Option<String>,
    pub acao: Option<String>,
    pub idfuncionario: Option<i64>,
    pub idtabela: Option<i64>,
    pub desde: Option<NaiveDate>,
    pub ate: Option<NaiveDate>,
}

#[async_trait]
pub trait LogRepository: Send + Sync {
    /// Inserção fora de transação — só para eventos sem mutação associada
    /// (login, falha de autenticação). Mutações de negócio gravam o log na
    /// mesma transação do repositório de domínio.
    async fn inserir(&self, log: NovoLog) -> Result<(), DomainError>;
    async fn listar(
        &self,
        filtro: &FiltroLog,
        page: PageParams,
    ) -> Result<Page<RegistroLog>, DomainError>;
}

#[async_trait]
pub trait DashboardRepository: Send + Sync {
    async fn cards(&self, hoje: NaiveDate) -> Result<DashboardCards, DomainError>;
    async fn ultimas_reservas(&self, limite: i64) -> Result<Vec<ReservaResumo>, DomainError>;
    async fn checkins_pendentes(&self, hoje: NaiveDate) -> Result<Vec<PendenciaDia>, DomainError>;
    async fn checkouts_pendentes(&self, hoje: NaiveDate) -> Result<Vec<PendenciaDia>, DomainError>;
    async fn acomodacoes_disponiveis_hoje(
        &self,
        hoje: NaiveDate,
    ) -> Result<Vec<(i64, String, i32)>, DomainError>;
    async fn acomodacoes_ocupadas(&self) -> Result<Vec<(i64, String, i32)>, DomainError>;
}

#[async_trait]
pub trait FinanceiroRepository: Send + Sync {
    /// Resumo de recebido/previsto num período arbitrário.
    async fn resumo(&self, periodo: PeriodoEstadia) -> Result<ResumoFinanceiro, DomainError>;
    /// Recebido diário no período (gráfico de linhas do legado).
    async fn serie_recebido(&self, periodo: PeriodoEstadia)
        -> Result<Vec<PontoSerie>, DomainError>;
    /// Recebido por forma de pagamento no período.
    async fn recebido_por_pagamento(
        &self,
        periodo: PeriodoEstadia,
    ) -> Result<Vec<PontoSerie>, DomainError>;
    /// Reservas criadas por dia no período (gráfico `cGraficoReservas`).
    async fn serie_reservas(&self, periodo: PeriodoEstadia)
        -> Result<Vec<PontoSerie>, DomainError>;
    /// Vendas de itens por dia no período (gráfico `cGraficoVendas`).
    async fn serie_vendas(&self, periodo: PeriodoEstadia) -> Result<Vec<PontoSerie>, DomainError>;
    /// Ranking de itens por quantidade vendida no período.
    async fn itens_mais_vendidos(
        &self,
        periodo: PeriodoEstadia,
    ) -> Result<Vec<ItemMaisVendido>, DomainError>;
    /// Linhas detalhadas de vendas no período (tabela "Vendas" do legado).
    async fn vendas(&self, periodo: PeriodoEstadia) -> Result<Vec<VendaItem>, DomainError>;
    /// Lucro de reservas agrupado por acomodação (gráfico `cFinanceiroReservas`).
    async fn lucro_por_acomodacao(
        &self,
        periodo: PeriodoEstadia,
    ) -> Result<Vec<PontoSerie>, DomainError>;
}
