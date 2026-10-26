//! Casos de uso do financeiro — resumos e séries temporais.
//! Equivalente a `financeiro/include/*`: valores do mês/ano, previstos,
//! gráficos de reservas e vendas.

use crate::error::AppResult;
use chrono::{Datelike, NaiveDate};
use clarituz_domain::ports::FinanceiroRepository;
use clarituz_domain::queries::{ItemMaisVendido, PontoSerie, ResumoFinanceiro, VendaItem};
use clarituz_domain::value_objects::PeriodoEstadia;
use clarituz_shared::time;
use std::sync::Arc;

pub struct FinanceiroService {
    repo: Arc<dyn FinanceiroRepository>,
}

impl FinanceiroService {
    pub fn new(repo: Arc<dyn FinanceiroRepository>) -> Self {
        Self { repo }
    }

    /// Resumo de um período arbitrário (default: mês corrente).
    pub async fn resumo(
        &self,
        inicio: Option<NaiveDate>,
        fim: Option<NaiveDate>,
    ) -> AppResult<ResumoFinanceiro> {
        let (ini, fim) = periodo_ou_mes_atual(inicio, fim);
        let periodo = PeriodoEstadia::new(ini, fim)?;
        Ok(self.repo.resumo(periodo).await?)
    }

    /// Recebido por dia no período.
    pub async fn serie_recebido(
        &self,
        inicio: Option<NaiveDate>,
        fim: Option<NaiveDate>,
    ) -> AppResult<Vec<PontoSerie>> {
        let (ini, fim) = periodo_ou_mes_atual(inicio, fim);
        Ok(self
            .repo
            .serie_recebido(PeriodoEstadia::new(ini, fim)?)
            .await?)
    }

    /// Recebido por forma de pagamento.
    pub async fn recebido_por_pagamento(
        &self,
        inicio: Option<NaiveDate>,
        fim: Option<NaiveDate>,
    ) -> AppResult<Vec<PontoSerie>> {
        let (ini, fim) = periodo_ou_mes_atual(inicio, fim);
        Ok(self
            .repo
            .recebido_por_pagamento(PeriodoEstadia::new(ini, fim)?)
            .await?)
    }

    /// Reservas criadas por dia.
    pub async fn serie_reservas(
        &self,
        inicio: Option<NaiveDate>,
        fim: Option<NaiveDate>,
    ) -> AppResult<Vec<PontoSerie>> {
        let (ini, fim) = periodo_ou_mes_atual(inicio, fim);
        Ok(self
            .repo
            .serie_reservas(PeriodoEstadia::new(ini, fim)?)
            .await?)
    }

    /// Vendas de itens por dia.
    pub async fn serie_vendas(
        &self,
        inicio: Option<NaiveDate>,
        fim: Option<NaiveDate>,
    ) -> AppResult<Vec<PontoSerie>> {
        let (ini, fim) = periodo_ou_mes_atual(inicio, fim);
        Ok(self
            .repo
            .serie_vendas(PeriodoEstadia::new(ini, fim)?)
            .await?)
    }

    /// Ranking dos itens mais vendidos no período.
    pub async fn itens_mais_vendidos(
        &self,
        inicio: Option<NaiveDate>,
        fim: Option<NaiveDate>,
    ) -> AppResult<Vec<ItemMaisVendido>> {
        let (ini, fim) = periodo_ou_mes_atual(inicio, fim);
        Ok(self
            .repo
            .itens_mais_vendidos(PeriodoEstadia::new(ini, fim)?)
            .await?)
    }

    /// Linhas detalhadas de vendas (tabela "Vendas").
    pub async fn vendas(
        &self,
        inicio: Option<NaiveDate>,
        fim: Option<NaiveDate>,
    ) -> AppResult<Vec<VendaItem>> {
        let (ini, fim) = periodo_ou_mes_atual(inicio, fim);
        Ok(self.repo.vendas(PeriodoEstadia::new(ini, fim)?).await?)
    }

    /// Lucro de reservas agrupado por acomodação.
    pub async fn lucro_por_acomodacao(
        &self,
        inicio: Option<NaiveDate>,
        fim: Option<NaiveDate>,
    ) -> AppResult<Vec<PontoSerie>> {
        let (ini, fim) = periodo_ou_mes_atual(inicio, fim);
        Ok(self
            .repo
            .lucro_por_acomodacao(PeriodoEstadia::new(ini, fim)?)
            .await?)
    }
}

/// `None` ⇒ mês corrente no fuso do negócio (como o legado).
fn periodo_ou_mes_atual(
    inicio: Option<NaiveDate>,
    fim: Option<NaiveDate>,
) -> (NaiveDate, NaiveDate) {
    match (inicio, fim) {
        (Some(i), Some(f)) => (i, f),
        _ => {
            let hoje = time::hoje();
            let ini = hoje.with_day(1).unwrap_or(hoje);
            let fim = if hoje.month() == 12 {
                NaiveDate::from_ymd_opt(hoje.year(), 12, 31).unwrap_or(hoje)
            } else {
                NaiveDate::from_ymd_opt(hoje.year(), hoje.month() + 1, 1)
                    .and_then(|d| d.pred_opt())
                    .unwrap_or(hoje)
            };
            (ini, fim)
        }
    }
}
