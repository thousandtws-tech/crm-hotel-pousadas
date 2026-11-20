//! Escalas & conformidade CLT — jornadas 5x1/6x1/12x36 derivadas da
//! âncora, turnos efetivos por dia e validador com sugestões de correção
//! aplicáveis em 1 clique (jornada, DSR, interjornada, almoço).

use std::sync::Arc;

use chrono::{DateTime, Duration, NaiveDate, TimeZone, Utc};
use clarituz_domain::entities::{CltCorrecao, CltViolacao, EscalaTurno, FuncionarioJornada};
use clarituz_domain::enums::{OrigemTurno, RegimeEscala};
use clarituz_domain::error::DomainError;
use clarituz_domain::ports::{EscalaRepository, NovoTurno};

use crate::actor::Ator;
use crate::dto::JornadaInput;
use crate::error::AppResult;

/// Jornada máxima regular: 8h/dia; hora extra legal até +2h (art. 59 CLT).
const JORNADA_REGULAR_MIN: i64 = 8 * 60;
const JORNADA_MAX_EXTRA_MIN: i64 = 10 * 60;
const JORNADA_12X36_MIN: i64 = 12 * 60;
/// Intervalo interjornada mínimo: 11h (art. 66 CLT).
const INTERJORNADA_MIN: i64 = 11 * 60;
/// Almoço: ≥1h p/ jornada >6h; ≥15min p/ 4–6h (art. 71 CLT).
const ALMOCO_JORNADA_LONGA_MIN: i64 = 6 * 60;
const ALMOCO_MIN_LONGA: i16 = 60;
const ALMOCO_MIN_CURTA: i16 = 15;
/// DSR — descanso semanal remunerado de 24h (art. 67 CLT).
const DSR_JANELA_DIAS: i64 = 7;

pub struct EscalasService {
    repo: Arc<dyn EscalaRepository>,
}

impl EscalasService {
    pub fn new(repo: Arc<dyn EscalaRepository>) -> Self {
        Self { repo }
    }

    pub async fn jornadas(&self) -> AppResult<Vec<FuncionarioJornada>> {
        Ok(self.repo.jornadas().await?)
    }

    /// Configura/atualiza a jornada do funcionário (upsert) e regenera os
    /// turnos dos próximos `dias` — idempotente por (idfuncionario,data).
    pub async fn gravar_jornada(
        &self,
        ator: &Ator,
        input: JornadaInput,
        dias: i64,
    ) -> AppResult<()> {
        ator.exigir_gerencial()?;
        let j = FuncionarioJornada {
            id: 0,
            idfuncionario: input.idfuncionario,
            regime: input.regime,
            entrada: input.entrada,
            saida: input.saida,
            almoco_min: input.almoco_min.unwrap_or(60),
            ancora: input.ancora,
            ativo: input.ativo.unwrap_or(true),
        };
        self.repo.gravar_jornada(&j).await?;
        self.gerar_escala(input.idfuncionario, dias.clamp(1, 60))
            .await
    }

    /// Deriva os turnos do regime — 5x1 (ciclo 6), 6x1 (ciclo 7), 12x36 (ciclo 2).
    pub async fn gerar_escala(&self, idfuncionario: i64, dias: i64) -> AppResult<()> {
        let Some(j) = self.repo.jornada_de(idfuncionario).await? else {
            return Err(DomainError::validacao("funcionário sem jornada configurada").into());
        };
        let hoje = Utc::now().date_naive();
        for i in 0..dias {
            let data = hoje + Duration::days(i);
            if !Self::trabalha(&j, data) {
                continue; // folga do ciclo — turno manual, se houver, prevalece
            }
            let (inicio, fim) = Self::turno_do_dia(&j, data);
            self.repo
                .gravar_turno(&NovoTurno {
                    idfuncionario,
                    data,
                    inicio,
                    fim,
                    almoco_min: j.almoco_min,
                    origem: OrigemTurno::Jornada,
                })
                .await?;
        }
        Ok(())
    }

    fn trabalha(j: &FuncionarioJornada, data: NaiveDate) -> bool {
        let delta = (data - j.ancora).num_days();
        if delta < 0 {
            return false;
        }
        let (ciclo, trabalhados) = match j.regime {
            RegimeEscala::CincoUm => (6, 5),
            RegimeEscala::SeisUm => (7, 6),
            RegimeEscala::DozeTrintaSeis => (2, 1),
        };
        delta % ciclo < trabalhados
    }

    fn turno_do_dia(j: &FuncionarioJornada, data: NaiveDate) -> (DateTime<Utc>, DateTime<Utc>) {
        let d = data.and_time(j.entrada);
        let inicio = Utc.from_utc_datetime(&d);
        // Saída no mesmo dia; 12x36 cruza a meia-noite se saída < entrada.
        let mut fim_d = data.and_time(j.saida);
        if j.saida <= j.entrada {
            fim_d = (data + Duration::days(1)).and_time(j.saida);
        }
        (inicio, Utc.from_utc_datetime(&fim_d))
    }

    pub async fn turnos(
        &self,
        inicio: NaiveDate,
        fim: NaiveDate,
        idfuncionario: Option<i64>,
    ) -> AppResult<Vec<EscalaTurno>> {
        Ok(self.repo.turnos(inicio, fim, idfuncionario).await?)
    }

    pub async fn remover_turno(&self, ator: &Ator, id: i64) -> AppResult<()> {
        ator.exigir_gerencial()?;
        Ok(self.repo.remover_turno(id).await?)
    }

    /// Edição inline de um turno existente — marca origem=manual.
    pub async fn editar_turno(
        &self,
        ator: &Ator,
        id: i64,
        inicio: DateTime<Utc>,
        fim: DateTime<Utc>,
        almoco_min: i16,
    ) -> AppResult<EscalaTurno> {
        ator.exigir_gerencial()?;
        if fim <= inicio {
            return Err(DomainError::validacao("fim deve ser após o início").into());
        }
        if !(0..=240).contains(&almoco_min) {
            return Err(DomainError::validacao("almoço inválido").into());
        }
        Ok(self
            .repo
            .ajustar_turno(id, inicio, fim, almoco_min, OrigemTurno::Manual)
            .await?)
    }

    // ------------------------------------------------------------------
    // validador CLT
    // ------------------------------------------------------------------

    /// Audita os turnos do período e devolve violações + correção sugerida.
    pub async fn validar(&self, ator: &Ator, dias: i64) -> AppResult<Vec<CltViolacao>> {
        ator.exigir_gerencial()?;
        let hoje = Utc::now().date_naive();
        let fim = hoje + Duration::days(dias.clamp(1, 60));
        let turnos = self
            .repo
            .turnos(hoje - Duration::days(1), fim, None)
            .await?;
        let mut violacoes = Vec::new();

        // Agrupa por funcionário.
        let mut por_func: std::collections::BTreeMap<i64, Vec<&EscalaTurno>> =
            std::collections::BTreeMap::new();
        for t in &turnos {
            por_func.entry(t.idfuncionario).or_default().push(t);
        }

        for (idfuncionario, mut ts) in por_func {
            ts.sort_by_key(|t| t.inicio);
            let nome = self
                .repo
                .nome_funcionario(idfuncionario)
                .await
                .unwrap_or_default();
            let jornada = self.repo.jornada_de(idfuncionario).await.ok().flatten();
            let eh_12x36 = jornada
                .as_ref()
                .is_some_and(|j| j.regime == RegimeEscala::DozeTrintaSeis);

            // jornada diária + almoço + interjornada
            for (i, t) in ts.iter().enumerate() {
                let bruto = (t.fim - t.inicio).num_minutes();
                let liquida = bruto - t.almoco_min as i64;
                let maximo = if eh_12x36 {
                    JORNADA_12X36_MIN
                } else {
                    JORNADA_MAX_EXTRA_MIN
                };
                if liquida > maximo {
                    let excedente = liquida - maximo;
                    violacoes.push(CltViolacao {
                        idfuncionario,
                        funcionario_nome: nome.clone(),
                        regra: "jornada_diaria".into(),
                        detalhe: format!(
                            "{}h{}min trabalhadas — máximo {}h{}min",
                            liquida / 60,
                            liquida % 60,
                            maximo / 60,
                            maximo % 60
                        ),
                        data: t.data,
                        severidade: "alta".into(),
                        correcao: Some(CltCorrecao::EncurtarTurno {
                            idturno: t.id,
                            novo_fim: t.fim - Duration::minutes(excedente),
                        }),
                    });
                } else if !eh_12x36 && liquida > JORNADA_REGULAR_MIN {
                    violacoes.push(CltViolacao {
                        idfuncionario,
                        funcionario_nome: nome.clone(),
                        regra: "jornada_diaria".into(),
                        detalhe: format!(
                            "{}h{}min — acima de 8h (hora extra, verificar banco de horas)",
                            liquida / 60,
                            liquida % 60
                        ),
                        data: t.data,
                        severidade: "media".into(),
                        correcao: None,
                    });
                }
                // almoço mínimo legal
                if liquida > ALMOCO_JORNADA_LONGA_MIN && t.almoco_min < ALMOCO_MIN_LONGA {
                    violacoes.push(CltViolacao {
                        idfuncionario,
                        funcionario_nome: nome.clone(),
                        regra: "almoco".into(),
                        detalhe: format!(
                            "intervalo de {}min — exigido ≥{}min p/ jornada >6h",
                            t.almoco_min, ALMOCO_MIN_LONGA
                        ),
                        data: t.data,
                        severidade: "alta".into(),
                        correcao: Some(CltCorrecao::AjustarAlmoco {
                            idturno: t.id,
                            novo_almoco_min: ALMOCO_MIN_LONGA,
                        }),
                    });
                } else if liquida > 4 * 60
                    && liquida <= ALMOCO_JORNADA_LONGA_MIN
                    && t.almoco_min < ALMOCO_MIN_CURTA
                {
                    violacoes.push(CltViolacao {
                        idfuncionario,
                        funcionario_nome: nome.clone(),
                        regra: "almoco".into(),
                        detalhe: format!(
                            "intervalo de {}min — exigido ≥{}min p/ jornada 4–6h",
                            t.almoco_min, ALMOCO_MIN_CURTA
                        ),
                        data: t.data,
                        severidade: "media".into(),
                        correcao: Some(CltCorrecao::AjustarAlmoco {
                            idturno: t.id,
                            novo_almoco_min: ALMOCO_MIN_CURTA,
                        }),
                    });
                }
                // interjornada ≥11h
                if i > 0 {
                    let anterior = ts[i - 1];
                    let descanso = (t.inicio - anterior.fim).num_minutes();
                    if (0..INTERJORNADA_MIN).contains(&descanso) {
                        let falta = INTERJORNADA_MIN - descanso;
                        violacoes.push(CltViolacao {
                            idfuncionario,
                            funcionario_nome: nome.clone(),
                            regra: "interjornada".into(),
                            detalhe: format!(
                                "descanso de {}h{}min entre turnos — mínimo 11h",
                                descanso / 60,
                                descanso % 60
                            ),
                            data: t.data,
                            severidade: "alta".into(),
                            correcao: Some(CltCorrecao::EmpurrarInicio {
                                idturno: t.id,
                                novo_inicio: t.inicio + Duration::minutes(falta),
                            }),
                        });
                    }
                }
            }

            // DSR — 7 dias consecutivos sem folga.
            let mut seguidos = 0i64;
            let mut ultima: Option<NaiveDate> = None;
            for t in &ts {
                let seguido = ultima.is_some_and(|u| (t.data - u).num_days() == 1);
                seguidos = if seguido { seguidos + 1 } else { 1 };
                ultima = Some(t.data);
                if seguidos >= DSR_JANELA_DIAS {
                    violacoes.push(CltViolacao {
                        idfuncionario,
                        funcionario_nome: nome.clone(),
                        regra: "dsr".into(),
                        detalhe: format!("{} dias consecutivos sem folga de 24h", seguidos),
                        data: t.data,
                        severidade: "alta".into(),
                        correcao: Some(CltCorrecao::Folgar { idturno: t.id }),
                    });
                    break; // uma violação de DSR por sequência
                }
            }
        }
        Ok(violacoes)
    }

    /// Aplica a correção sugerida — mesma semântica do "confirmar_acao" da Maria.
    pub async fn aplicar_correcao(&self, ator: &Ator, correcao: &CltCorrecao) -> AppResult<()> {
        ator.exigir_gerencial()?;
        match correcao {
            CltCorrecao::EncurtarTurno { idturno, novo_fim } => {
                let t = self.turno_ou_erro(*idturno).await?;
                if *novo_fim <= t.inicio {
                    return Err(DomainError::validacao("fim deve ser após o início").into());
                }
                self.repo
                    .ajustar_turno(
                        *idturno,
                        t.inicio,
                        *novo_fim,
                        t.almoco_min,
                        OrigemTurno::CltFix,
                    )
                    .await?;
            }
            CltCorrecao::AjustarAlmoco {
                idturno,
                novo_almoco_min,
            } => {
                let t = self.turno_ou_erro(*idturno).await?;
                self.repo
                    .ajustar_turno(
                        *idturno,
                        t.inicio,
                        t.fim,
                        *novo_almoco_min,
                        OrigemTurno::CltFix,
                    )
                    .await?;
            }
            CltCorrecao::Folgar { idturno } => {
                self.repo.remover_turno(*idturno).await?;
            }
            CltCorrecao::EmpurrarInicio {
                idturno,
                novo_inicio,
            } => {
                let t = self.turno_ou_erro(*idturno).await?;
                if *novo_inicio >= t.fim {
                    return Err(DomainError::validacao("início deve ser antes do fim").into());
                }
                self.repo
                    .ajustar_turno(
                        *idturno,
                        *novo_inicio,
                        t.fim,
                        t.almoco_min,
                        OrigemTurno::CltFix,
                    )
                    .await?;
            }
        }
        Ok(())
    }

    async fn turno_ou_erro(&self, id: i64) -> AppResult<EscalaTurno> {
        self.repo
            .turno_por_id(id)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("turno não encontrado").into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveTime;

    fn j(regime: RegimeEscala, ancora: NaiveDate) -> FuncionarioJornada {
        FuncionarioJornada {
            id: 1,
            idfuncionario: 1,
            regime,
            entrada: NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
            saida: NaiveTime::from_hms_opt(16, 0, 0).unwrap(),
            almoco_min: 60,
            ancora,
            ativo: true,
        }
    }

    #[test]
    fn cinco_um_trabalha_5_folga_1() {
        let j = j(
            RegimeEscala::CincoUm,
            NaiveDate::from_ymd_opt(2026, 11, 2).unwrap(),
        );
        let trabalhados: Vec<_> = (0..6)
            .filter(|i| EscalasService::trabalha(&j, j.ancora + Duration::days(*i)))
            .collect();
        assert_eq!(trabalhados.len(), 5);
        assert!(!EscalasService::trabalha(&j, j.ancora + Duration::days(5)));
    }

    #[test]
    fn seis_um_trabalha_6_folga_1() {
        let j = j(
            RegimeEscala::SeisUm,
            NaiveDate::from_ymd_opt(2026, 11, 2).unwrap(),
        );
        assert!(!EscalasService::trabalha(&j, j.ancora + Duration::days(6)));
        assert!(EscalasService::trabalha(&j, j.ancora + Duration::days(7))); // novo ciclo
    }

    #[test]
    fn doze_trinta_seis_alterna_dias() {
        let j = j(
            RegimeEscala::DozeTrintaSeis,
            NaiveDate::from_ymd_opt(2026, 11, 2).unwrap(),
        );
        let padrao: Vec<bool> = (0..6)
            .map(|i| EscalasService::trabalha(&j, j.ancora + Duration::days(i)))
            .collect();
        assert_eq!(padrao, vec![true, false, true, false, true, false]);
    }

    #[test]
    fn antes_da_ancora_nao_trabalha() {
        let j = j(
            RegimeEscala::CincoUm,
            NaiveDate::from_ymd_opt(2026, 11, 2).unwrap(),
        );
        assert!(!EscalasService::trabalha(&j, j.ancora - Duration::days(1)));
    }

    #[test]
    fn turno_cruza_meia_noite_quando_saida_menor() {
        let mut j = j(
            RegimeEscala::DozeTrintaSeis,
            NaiveDate::from_ymd_opt(2026, 11, 2).unwrap(),
        );
        j.entrada = NaiveTime::from_hms_opt(18, 0, 0).unwrap();
        j.saida = NaiveTime::from_hms_opt(6, 0, 0).unwrap();
        let (_, fim) = EscalasService::turno_do_dia(&j, j.ancora);
        assert_eq!(fim.date_naive(), j.ancora + Duration::days(1));
        assert_eq!(
            (fim - EscalasService::turno_do_dia(&j, j.ancora).0).num_hours(),
            12
        );
    }
}
