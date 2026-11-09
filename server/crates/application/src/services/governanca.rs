//! Governança & housekeeping — tarefas de limpeza, previsão de demanda
//! (checkouts + stayovers vs. capacidade da equipe), geração D-1 às 22h,
//! lavanderia por lotes e enxoval rastreável.

use std::sync::Arc;

use chrono::{Datelike, Duration, NaiveDate, Utc};
use clarituz_domain::entities::{EnxovalMov, GovernancaTarefa, LavanderiaLote};
use clarituz_domain::enums::{StatusTarefaGov, TipoTarefaGov};
use clarituz_domain::error::DomainError;
use clarituz_domain::events::{Aviso, TipoAviso};
use clarituz_domain::ports::{
    EventoPublisher, GovernancaRepository, NovaTarefa, NovoLote, NovoMovEnxoval,
};

use crate::actor::Ator;
use crate::dto::{NovaTarefaInput, NovoLoteInput, NovoMovEnxovalInput};
use crate::error::AppResult;

const MIN_CHECKOUT: i16 = 60;
const MIN_STAYOVER: i16 = 30;
const MIN_SEMANAL: i16 = 45;

pub struct GovernancaService {
    repo: Arc<dyn GovernancaRepository>,
    eventos: Arc<dyn EventoPublisher>,
}

impl GovernancaService {
    pub fn new(repo: Arc<dyn GovernancaRepository>, eventos: Arc<dyn EventoPublisher>) -> Self {
        Self { repo, eventos }
    }

    // ------------------------------------------------------------------
    // tarefas
    // ------------------------------------------------------------------

    pub async fn quadro(&self, data: Option<NaiveDate>) -> AppResult<Vec<GovernancaTarefa>> {
        let data = data.unwrap_or_else(|| Utc::now().date_naive());
        Ok(self.repo.tarefas_dia(data).await?)
    }

    pub async fn criar(&self, ator: &Ator, input: NovaTarefaInput) -> AppResult<GovernancaTarefa> {
        let _ = ator;
        Ok(self
            .repo
            .criar_tarefa(&NovaTarefa {
                idquarto: input.idquarto,
                data: input.data.unwrap_or_else(|| Utc::now().date_naive()),
                tipo: input.tipo,
                estimado_min: input.estimado_min.unwrap_or(MIN_SEMANAL),
                idfuncionario: input.idfuncionario,
                origem: "manual".into(),
                observacao: input.observacao,
            })
            .await?)
    }

    pub async fn mudar_status(
        &self,
        ator: &Ator,
        id: i64,
        status: StatusTarefaGov,
    ) -> AppResult<()> {
        let _ = ator;
        Ok(self.repo.mudar_status_tarefa(id, status).await?)
    }

    pub async fn atribuir(&self, ator: &Ator, id: i64, idfuncionario: i64) -> AppResult<()> {
        ator.exigir_gerencial()?;
        Ok(self.repo.atribuir(id, idfuncionario).await?)
    }

    // ------------------------------------------------------------------
    // previsão de demanda — 14 dias à frente
    // ------------------------------------------------------------------

    /// Demanda estimada (min) × capacidade da equipe (min) por dia.
    /// Checkout=60min, stayover=30min; sexta/sábado entra faxina semanal.
    pub async fn previsao(&self) -> AppResult<serde_json::Value> {
        let hoje = Utc::now().date_naive();
        let mut dias = Vec::new();
        for i in 0..14 {
            let data = hoje + Duration::days(i);
            let checkouts = self.repo.checkouts_do_dia(data).await?.len() as i64;
            let stayovers = self.repo.stayovers_do_dia(data).await?.len() as i64;
            let mut demanda = checkouts * MIN_CHECKOUT as i64 + stayovers * MIN_STAYOVER as i64;
            // Faxina semanal de áreas comuns às segundas (weekday Mon=0).
            if data.weekday() == chrono::Weekday::Mon {
                demanda += MIN_SEMANAL as i64;
            }
            let capacidade = self.repo.capacidade_governanca_min(data).await?;
            let tarefas_geradas: i64 = self
                .repo
                .tarefas_dia(data)
                .await?
                .iter()
                .map(|t| t.estimado_min as i64)
                .sum();
            dias.push(serde_json::json!({
                "data": data,
                "checkouts": checkouts,
                "stayovers": stayovers,
                "demanda_min": demanda.max(tarefas_geradas),
                "capacidade_min": capacidade,
                "situacao": if capacidade == 0 && demanda > 0 { "sem_equipe" }
                    else if demanda > capacidade { "sobrecarga" }
                    else { "ok" },
            }));
        }
        Ok(serde_json::json!(dias))
    }

    /// Cron D-1 (~22:00 UTC): gera as tarefas de amanhã. Idempotente pela
    /// UNIQUE (idquarto,data,tipo) — roda em todas as réplicas sem duplicar.
    pub async fn gerar_d1(&self) -> AppResult<i64> {
        let amanha = Utc::now().date_naive() + Duration::days(1);
        let mut criadas = 0i64;
        for idquarto in self.repo.checkouts_do_dia(amanha).await? {
            if self
                .repo
                .criar_tarefa_se_ausente(&NovaTarefa {
                    idquarto: Some(idquarto),
                    data: amanha,
                    tipo: TipoTarefaGov::Checkout,
                    estimado_min: MIN_CHECKOUT,
                    idfuncionario: None,
                    origem: "d1".into(),
                    observacao: String::new(),
                })
                .await?
            {
                criadas += 1;
            }
        }
        for idquarto in self.repo.stayovers_do_dia(amanha).await? {
            if self
                .repo
                .criar_tarefa_se_ausente(&NovaTarefa {
                    idquarto: Some(idquarto),
                    data: amanha,
                    tipo: TipoTarefaGov::Stayover,
                    estimado_min: MIN_STAYOVER,
                    idfuncionario: None,
                    origem: "d1".into(),
                    observacao: String::new(),
                })
                .await?
            {
                criadas += 1;
            }
        }
        if criadas > 0 {
            let mut aviso = Aviso::novo(
                TipoAviso::Info,
                "Governança — tarefas de amanhã geradas",
                format!(
                    "{criadas} tarefas de limpeza criadas para {}.",
                    amanha.format("%d/%m")
                ),
            );
            aviso.ate_nivel = 3;
            self.eventos.avisar(aviso);
        }
        Ok(criadas)
    }

    // ------------------------------------------------------------------
    // lavanderia
    // ------------------------------------------------------------------

    pub async fn lotes(&self, competencia: Option<NaiveDate>) -> AppResult<Vec<LavanderiaLote>> {
        Ok(self.repo.lav_lotes(competencia).await?)
    }

    pub async fn abrir_lote(&self, ator: &Ator, input: NovoLoteInput) -> AppResult<LavanderiaLote> {
        let _ = ator;
        if input.qtd_itens <= 0 {
            return Err(DomainError::validacao("quantidade deve ser positiva").into());
        }
        let competencia = input
            .competencia
            .unwrap_or_else(|| Utc::now().date_naive().with_day(1).unwrap());
        Ok(self
            .repo
            .lav_abrir(&NovoLote {
                fornecedor: input.fornecedor,
                competencia,
                qtd_itens: input.qtd_itens,
                custo_centavos: input.custo_centavos,
                observacao: input.observacao,
            })
            .await?)
    }

    pub async fn devolver_lote(
        &self,
        ator: &Ator,
        id: i64,
        qtd_devolvida: i32,
        custo_centavos: Option<i64>,
    ) -> AppResult<()> {
        let _ = ator;
        if qtd_devolvida <= 0 {
            return Err(DomainError::validacao("devolução deve ser positiva").into());
        }
        Ok(self
            .repo
            .lav_devolver(id, qtd_devolvida, custo_centavos)
            .await?)
    }

    /// Fecha o mês — gera a conta a pagar consolidada (mesma regra das compras).
    pub async fn fechar_mes(&self, ator: &Ator, competencia: NaiveDate) -> AppResult<i64> {
        ator.exigir_gerencial()?;
        let idlanc = self.repo.lav_fechar_competencia(competencia).await?;
        self.eventos.avisar({
            let mut a = Aviso::novo(
                TipoAviso::Sucesso,
                "Lavanderia — competência fechada",
                format!(
                    "Conta a pagar #{} gerada para {}.",
                    idlanc,
                    competencia.format("%m/%Y")
                ),
            );
            a.ate_nivel = 2;
            a
        });
        Ok(idlanc)
    }

    // ------------------------------------------------------------------
    // enxoval
    // ------------------------------------------------------------------

    pub async fn enxoval_saldo(&self) -> AppResult<Vec<(String, i64)>> {
        Ok(self.repo.enxoval_saldo().await?)
    }

    pub async fn enxoval_mov(&self) -> AppResult<Vec<EnxovalMov>> {
        Ok(self.repo.enxoval_mov(200).await?)
    }

    pub async fn enxoval_registrar(
        &self,
        ator: &Ator,
        input: NovoMovEnxovalInput,
    ) -> AppResult<()> {
        Ok(self
            .repo
            .enxoval_registrar(&NovoMovEnxoval {
                tipo_item: input.tipo_item,
                quantidade: input.quantidade,
                origem: input.origem,
                destino: input.destino,
                idlote: input.idlote,
                idquarto: input.idquarto,
                registrado_por: Some(ator.id),
            })
            .await?)
    }
}
