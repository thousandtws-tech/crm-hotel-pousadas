//! Inteligência preditiva da pousada — 100% determinística (SQL + regras),
//! zero custo de LLM. Cobre: BI (ocupação/receita/fluxo 70-30), score de
//! no-show, perfil VIP→Churn, pace vs ano anterior, escala ideal por setor,
//! upsell por disponibilidade real, estoque preditivo, manutenção
//! preventiva por uso e histórico 12m pro contexto da Inná.

use std::sync::Arc;
use std::time::{Duration, Instant};

use chrono::Utc;
use clarituz_domain::entities::preditivo::*;
use clarituz_domain::ports::preditivo::PreditivoRepository;
use rust_decimal::prelude::FromPrimitive;
use rust_decimal::Decimal;

use crate::actor::Ator;
use crate::error::AppResult;

/// Minutos de trabalho por unidade de demanda, por setor.
const MIN_GOVERNANCA_CHECKOUT: i64 = 60;
const MIN_GOVERNANCA_STAYOVER: i64 = 30;
const MIN_RECEPCAO_POR_MOVIMENTO: i64 = 30;
const MIN_COZINHA_POR_HOSPEDE: i64 = 12;
/// Capacidade efetiva de um turno (8h líquidas).
const MIN_TURNO: i64 = 480;
/// LTV (centavos do ponto de vista de negócio — em R$) que coroa um VIP.
const LTV_VIP: i64 = 5000;
const ESTADIAS_VIP: i64 = 3;
const DIAS_ATIVO: i64 = 180;
const DIAS_EM_RISCO: i64 = 365;
/// TTL do resumo executivo — dado de dashboard, minuto de defasagem
/// é imperceptível e evita reexecutar 7 agregações por refresh.
const RESUMO_TTL: Duration = Duration::from_secs(60);

pub struct PreditivoService {
    repo: Arc<dyn PreditivoRepository>,
    /// Cache single-flight: o write lock segura a recompute — concorrentes
    /// esperam e leem a entrada fresca em vez de disparar N×7 queries.
    resumo_cache: tokio::sync::RwLock<Option<(Instant, IaResumo)>>,
}

impl PreditivoService {
    pub fn new(repo: Arc<dyn PreditivoRepository>) -> Self {
        Self {
            repo,
            resumo_cache: tokio::sync::RwLock::new(None),
        }
    }

    // ------------------------------------------------------------------
    // BI
    // ------------------------------------------------------------------

    pub async fn ocupacao_14d(&self, _ator: &Ator) -> AppResult<Vec<DiaOcupacao>> {
        self.repo.ocupacao_14d().await.map_err(Into::into)
    }

    pub async fn receita_4sem(&self, _ator: &Ator) -> AppResult<Vec<SemanaReceita>> {
        self.repo.receita_4sem().await.map_err(Into::into)
    }

    /// Modelo 70/30: pesa 70% o que já está confirmado a receber e 30% a
    /// média histórica de 90d — conservador sem ignorar o pipeline.
    pub async fn fluxo_caixa_30d(&self, ator: &Ator) -> AppResult<FluxoCaixa30d> {
        ator.exigir_gerencial()?;
        let r = self.repo.fluxo_caixa_30d().await?;
        let setenta = Decimal::from_f64(0.70).unwrap_or_default();
        let trinta = Decimal::from_f64(0.30).unwrap_or_default();
        let previstas = r.entradas_confirmadas * setenta + r.media_historica_90d * trinta;
        Ok(FluxoCaixa30d {
            entradas_confirmadas: r.entradas_confirmadas,
            media_historica_90d: r.media_historica_90d,
            entradas_previstas: previstas.round_dp(2),
            saidas_previstas: r.saidas_previstas,
            saldo_previsto: (previstas - r.saidas_previstas).round_dp(2),
        })
    }

    pub async fn historico_12m(&self, _ator: &Ator) -> AppResult<Vec<MesHistorico>> {
        self.repo.historico_12m().await.map_err(Into::into)
    }

    // ------------------------------------------------------------------
    // Score de cancelamento / no-show (0-100)
    // ------------------------------------------------------------------

    pub async fn risco_cancelamentos(&self, _ator: &Ator) -> AppResult<Vec<ReservaRisco>> {
        let rows = self.repo.reservas_risco().await?;
        Ok(rows.iter().map(Self::score_reserva).collect())
    }

    fn score_reserva(r: &ReservaRiscoRow) -> ReservaRisco {
        let mut score: i32 = 0;
        let mut sinais = Vec::new();

        if r.reservas_anteriores > 0 {
            let ratio = r.cancelamentos_anteriores as f64 / r.reservas_anteriores as f64;
            let pts = (ratio * 40.0) as i32;
            if pts >= 10 {
                score += pts;
                sinais.push(format!(
                    "{}/{} reservas anteriores canceladas",
                    r.cancelamentos_anteriores, r.reservas_anteriores
                ));
            }
        }
        if !r.tem_pagamento_pago && !r.tem_pagamento_pendente {
            score += 25;
            sinais.push("Nenhum pagamento registrado".into());
        } else if !r.tem_pagamento_pago {
            score += 15;
            sinais.push("Pagamento ainda pendente".into());
        }
        if r.lead_time_dias < 2 {
            score += 15;
            sinais.push("Reserva de última hora".into());
        } else if r.lead_time_dias < 7 {
            score += 8;
            sinais.push("Lead time curto".into());
        }
        if !r.tem_contato {
            score += 10;
            sinais.push("Sem telefone nem e-mail".into());
        }
        if r.estadias_anteriores == 0 {
            score += 10;
            sinais.push("Primeira estadia".into());
        }
        if r.dias_ate_checkin > 90 {
            score += 5;
            sinais.push("Check-in muito distante".into());
        }

        let score = score.clamp(0, 100);
        let (nivel, acao) = if score >= 60 {
            (
                "vermelho",
                "Ligar para confirmar e cobrar o sinal — considere overbooking controlado",
            )
        } else if score >= 30 {
            (
                "amarelo",
                "Enviar lembrete de confirmação e cobrança do sinal",
            )
        } else {
            ("verde", "Fluxo normal — sem ação preventiva")
        };

        ReservaRisco {
            idreserva: r.idreserva,
            cliente: r.cliente.clone(),
            acomodacao: r.acomodacao.clone(),
            entrada: r.entrada,
            score,
            nivel: nivel.into(),
            sinais,
            acao: acao.into(),
        }
    }

    // ------------------------------------------------------------------
    // Perfil inteligente / LTV & churn
    // ------------------------------------------------------------------

    pub async fn perfis(&self, _ator: &Ator) -> AppResult<Vec<PerfilHospede>> {
        let rows = self.repo.perfis_hospedes().await?;
        let hoje = Utc::now().date_naive();
        Ok(rows
            .iter()
            .map(|r| {
                let ltv = r.receita_estadias + r.receita_consumo;
                let dias_sem_voltar = r.ultima_estadia.map_or(i64::MAX, |u| (hoje - u).num_days());
                let classe = if ltv >= Decimal::from(LTV_VIP) && r.estadias >= ESTADIAS_VIP {
                    "vip"
                } else if r.estadias == 0 {
                    "novo"
                } else if dias_sem_voltar <= DIAS_ATIVO {
                    "ativo"
                } else if dias_sem_voltar <= DIAS_EM_RISCO {
                    "em_risco"
                } else {
                    "churn"
                };
                PerfilHospede {
                    idcliente: r.idcliente,
                    nome: r.nome.clone(),
                    estadias: r.estadias,
                    ultima_estadia: r.ultima_estadia,
                    ltv,
                    classe: classe.into(),
                }
            })
            .collect())
    }

    // ------------------------------------------------------------------
    // Pace & demanda por tipo (30d)
    // ------------------------------------------------------------------

    pub async fn pace(&self, _ator: &Ator) -> AppResult<Pace> {
        let r = self.repo.pace().await?;
        let variacao = if r.receita_ano_anterior > Decimal::ZERO {
            ((r.receita_atual - r.receita_ano_anterior) / r.receita_ano_anterior
                * Decimal::from(100))
            .round_dp(1)
        } else if r.receita_atual > Decimal::ZERO {
            Decimal::from(100)
        } else {
            Decimal::ZERO
        };
        let recomendacao = if variacao >= Decimal::from(10) {
            "Ritmo acima do ano anterior — janela para subir a diária média"
        } else if variacao <= Decimal::from(-10) {
            "Ritmo abaixo — considere pacote promocional ou campanha de reativação"
        } else {
            "Ritmo estável — manter estratégia de preço"
        };
        Ok(Pace {
            reservas_atual: r.reservas_atual,
            receita_atual: r.receita_atual,
            reservas_ano_anterior: r.reservas_ano_anterior,
            receita_ano_anterior: r.receita_ano_anterior,
            variacao_pct: variacao,
            recomendacao: recomendacao.into(),
        })
    }

    // ------------------------------------------------------------------
    // Escala inteligente (headcount ideal por setor × dia)
    // ------------------------------------------------------------------

    pub async fn escala_ideal(&self, _ator: &Ator) -> AppResult<Vec<EscalaDia>> {
        let rows = self.repo.escala_demanda_14d().await?;
        let mut out = Vec::with_capacity(rows.len() * 3);
        for r in &rows {
            let demandas = [
                (
                    "governanca",
                    r.checkouts * MIN_GOVERNANCA_CHECKOUT + r.stayovers * MIN_GOVERNANCA_STAYOVER,
                    r.gov_escalados,
                ),
                (
                    "recepcao",
                    (r.checkins + r.checkouts) * MIN_RECEPCAO_POR_MOVIMENTO + MIN_TURNO / 2,
                    r.rec_escalados,
                ),
                (
                    "cozinha",
                    r.hospedes * MIN_COZINHA_POR_HOSPEDE,
                    r.coz_escalados,
                ),
            ];
            for (setor, demanda_min, escalado) in demandas {
                let sugerido = if demanda_min <= 0 {
                    0
                } else {
                    ((demanda_min + MIN_TURNO - 1) / MIN_TURNO).max(1)
                };
                out.push(EscalaDia {
                    data: r.data,
                    setor: setor.into(),
                    demanda_min,
                    sugerido,
                    escalado,
                    deficit: sugerido - escalado,
                });
            }
        }
        Ok(out)
    }

    // ------------------------------------------------------------------
    // Upsell por disponibilidade real
    // ------------------------------------------------------------------

    pub async fn upsells(&self, _ator: &Ator) -> AppResult<Vec<Upsell>> {
        self.repo.upsells().await.map_err(Into::into)
    }

    // ------------------------------------------------------------------
    // Estoque preditivo — consumo médio ajustado pela ocupação prevista
    // ------------------------------------------------------------------

    pub async fn estoque_previsto(&self, _ator: &Ator) -> AppResult<Vec<ItemEstoquePrev>> {
        let itens = self.repo.estoque_consumo().await?;
        let ocup = self.repo.ocupacao_14d().await?;
        let hist = self.repo.historico_12m().await?;

        let ocup_prevista = media_ocupacao(&ocup);
        let ocup_hist = hist
            .iter()
            .rev()
            .take(3)
            .map(|m| m.ocupacao_pct)
            .fold(Decimal::ZERO, |a, b| a + b)
            / Decimal::from(3);
        let fator = if ocup_hist > Decimal::ZERO {
            (ocup_prevista / ocup_hist)
                .max(Decimal::from_f64(0.5).unwrap_or_default())
                .min(Decimal::from(2))
        } else {
            Decimal::ONE
        };

        Ok(itens
            .iter()
            .filter(|i| i.consumo_30d > 0)
            .map(|i| {
                let consumo_diario = Decimal::from(i.consumo_30d) / Decimal::from(30);
                let demanda = (consumo_diario * Decimal::from(14) * fator).round_dp(0);
                let dias_restantes = if consumo_diario > Decimal::ZERO {
                    Some(
                        (Decimal::from(i.saldo) / (consumo_diario * fator))
                            .round_dp(0)
                            .to_string()
                            .parse::<i64>()
                            .unwrap_or(0),
                    )
                } else {
                    None
                };
                let sugestao = (demanda * Decimal::from_f64(1.5).unwrap_or_default()
                    - Decimal::from(i.saldo))
                .round_dp(0)
                .max(Decimal::ZERO)
                .to_string()
                .parse::<i64>()
                .unwrap_or(0)
                    + i64::from(i.estoque_minimo);
                ItemEstoquePrev {
                    iditem: i.iditem,
                    nome: i.nome.clone(),
                    saldo: i.saldo,
                    consumo_diario_medio: consumo_diario.round_dp(2),
                    demanda_prevista_14d: demanda,
                    dias_restantes,
                    sugestao_compra: sugestao,
                }
            })
            .collect())
    }

    // ------------------------------------------------------------------
    // Manutenção preventiva por padrão de uso
    // ------------------------------------------------------------------

    pub async fn risco_quartos(&self, _ator: &Ator) -> AppResult<Vec<RiscoQuarto>> {
        let rows = self.repo.risco_quartos().await?;
        let mut out: Vec<RiscoQuarto> = rows
            .iter()
            .map(|r| {
                let score = r.noites_90d / 5 + r.os_90d * 15 + r.os_abertas * 20;
                let (nivel, rec) = if score >= 60 {
                    (
                        "vermelho",
                        "Agendar inspeção preventiva antes do próximo check-in",
                    )
                } else if score >= 30 {
                    ("amarelo", "Incluir no próximo ciclo de inspeção programada")
                } else {
                    ("verde", "Sem ação — quarto dentro do padrão de uso")
                };
                RiscoQuarto {
                    idquarto: r.idquarto,
                    quarto: format!("{} ({})", r.numero, r.acomodacao),
                    noites_90d: r.noites_90d,
                    os_90d: r.os_90d,
                    score,
                    nivel: nivel.into(),
                    recomendacao: rec.into(),
                }
            })
            .collect();
        out.sort_by_key(|q| std::cmp::Reverse(q.score));
        Ok(out)
    }

    // ------------------------------------------------------------------
    // Resumo executivo — 1 chamada pro dashboard e pro contexto da Inná
    // ------------------------------------------------------------------

    pub async fn resumo(&self, ator: &Ator) -> AppResult<IaResumo> {
        // Autorização antes do cache: sem isso um ator sem nível gerencial
        // receberia a entrada cacheada que ele nunca conseguiria calcular.
        ator.exigir_gerencial()?;
        {
            let guard = self.resumo_cache.read().await;
            if let Some((em, r)) = &*guard {
                if em.elapsed() < RESUMO_TTL {
                    return Ok(r.clone());
                }
            }
        }
        let mut guard = self.resumo_cache.write().await;
        if let Some((em, r)) = &*guard {
            if em.elapsed() < RESUMO_TTL {
                return Ok(r.clone());
            }
        }
        let r = self.resumo_calcular(ator).await?;
        *guard = Some((Instant::now(), r.clone()));
        Ok(r)
    }

    /// As 7 agregações rodam em paralelo — o tempo de resposta passa a ser
    /// o da query mais lenta, não a soma de todos os round-trips.
    async fn resumo_calcular(&self, ator: &Ator) -> AppResult<IaResumo> {
        let (ocup, fluxo, pace, riscos, upsells, perfis, receita) = tokio::try_join!(
            self.ocupacao_14d(ator),
            self.fluxo_caixa_30d(ator),
            self.pace(ator),
            self.risco_cancelamentos(ator),
            self.upsells(ator),
            self.perfis(ator),
            self.receita_4sem(ator),
        )?;
        let mut mapa = std::collections::HashMap::new();
        for p in &perfis {
            *mapa.entry(p.classe.clone()).or_insert(0i64) += 1;
        }
        Ok(IaResumo {
            ocupacao_media_pct: media_ocupacao(&ocup),
            ocupacao_14d: ocup,
            receita_4sem: receita,
            fluxo,
            pace,
            riscos_altos: riscos.iter().filter(|r| r.nivel == "vermelho").count() as i64,
            upsells: upsells.len() as i64,
            perfis: mapa,
        })
    }
}

fn media_ocupacao(dias: &[DiaOcupacao]) -> Decimal {
    if dias.is_empty() {
        return Decimal::ZERO;
    }
    let total: i64 = dias.iter().map(|d| d.ocupados).sum();
    let capacidade: i64 = dias.iter().map(|d| d.total_quartos).sum();
    if capacidade == 0 {
        return Decimal::ZERO;
    }
    (Decimal::from(total) / Decimal::from(capacidade) * Decimal::from(100)).round_dp(1)
}
