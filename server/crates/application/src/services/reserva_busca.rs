//! Motor de busca público — `POST /publico/disponibilidade/busca`.
//!
//! O navegador envia a consulta serializada (datas+tolerância OU
//! flexível+meses, composição de hóspedes, categoria opcional) e o
//! servidor REGERA os períodos candidatos — a prévia do frontend nunca
//! é autoridade. Cada período reusa `ReservaRepository::disponibilidade`
//! (mesma semântica de bloqueio/reserva do balcão) e o resultado só
//! lista unidades publicadas no CMS — o site vende o que tem página.
//!
//! Definições de produto (também em docs/):
//! - tolerância desloca a viagem INTEIRA, preservando noites;
//! - `weekend` = sexta→domingo, `week` = 7 noites, `month` = mês
//!   calendário com ajuste ao último dia válido do mês seguinte;
//! - bebês contam na capacidade física (sem isenção automática);
//! - pets não filtram — devolvemos `aviso` objetivo.

use std::collections::{BTreeSet, HashMap};
use std::sync::Arc;

use chrono::{Datelike, Days, Months, NaiveDate};

use crate::dto::reservas::{
    BuscaAcomodacaoOut, BuscaAlternativaOut, BuscaDateInput, BuscaHospedesInput, BuscaPublicaInput,
    BuscaPublicaResponse, StayPresetInput, TOLERANCIAS_VALIDAS,
};
use crate::error::AppResult;
use clarituz_domain::ports::{CmsRepository, ReservaRepository};
use clarituz_domain::value_objects::PeriodoEstadia;
use clarituz_domain::DomainError;
use clarituz_shared::time;

/// Horizonte de entrada: 12 meses (cartões) a partir do mês corrente.
const HORIZONTE_MESES: u32 = 12;
/// Meses selecionáveis no modo flexível.
const MAX_MESES_SELECIONADOS: usize = 12;
/// Períodos candidatos por consulta — acima disso a busca é rejeitada
/// com validação clara em vez de cortar resultados em silêncio.
const MAX_CANDIDATOS: usize = 120;
/// Ocupação máxima aceita (faixa tarifária cobre 1..20).
const MAX_PESSOAS: i32 = 20;

pub struct BuscaReservaService {
    reservas: Arc<dyn ReservaRepository>,
    cms: Arc<dyn CmsRepository>,
}

/// Período candidato — `deslocamento` só existe no modo `dates`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Candidato {
    inicio: NaiveDate,
    fim: NaiveDate,
    deslocamento: Option<i32>,
}

impl BuscaReservaService {
    pub fn new(reservas: Arc<dyn ReservaRepository>, cms: Arc<dyn CmsRepository>) -> Self {
        Self { reservas, cms }
    }

    pub async fn buscar(&self, input: BuscaPublicaInput) -> AppResult<BuscaPublicaResponse> {
        let hoje = time::hoje();
        let horizonte = hoje
            .checked_add_months(Months::new(HORIZONTE_MESES))
            .ok_or_else(|| DomainError::validacao("Horizonte de busca inválido."))?;

        let pessoas = validar_hospedes(&input.guests)?;
        let candidatos = gerar_candidatos(&input.date, hoje, horizonte)?;
        if candidatos.is_empty() {
            return Err(DomainError::validacao(
                "Nenhuma data elegível dentro do horizonte — ajuste datas ou meses.",
            )
            .into());
        }
        if candidatos.len() > MAX_CANDIDATOS {
            return Err(DomainError::validacao(format!(
                "A busca gerou {} períodos (máximo {}) — reduza os meses selecionados ou a margem de dias.",
                candidatos.len(),
                MAX_CANDIDATOS
            ))
            .into());
        }

        // Contexto de categoria: slug publicado → unidade específica.
        let publicadas: HashMap<i64, clarituz_domain::entities::AcomodacaoPublica> = self
            .cms
            .listar_publicadas()
            .await?
            .into_iter()
            .map(|a| (a.id, a))
            .collect();

        let idacomodacao = match &input.acomodacao_slug {
            Some(slug) => Some(
                publicadas
                    .values()
                    .find(|a| a.slug == *slug)
                    .map(|a| a.id)
                    .ok_or_else(|| DomainError::validacao("Acomodação da busca não encontrada."))?,
            ),
            None => None,
        };

        let mut alternativas = Vec::new();
        for c in &candidatos {
            let periodo = PeriodoEstadia::new(c.inicio, c.fim)?;
            let disponiveis = self
                .reservas
                .disponibilidade(periodo, Some(pessoas), idacomodacao, None)
                .await?;

            let acomodacoes: Vec<BuscaAcomodacaoOut> = disponiveis
                .into_iter()
                .filter(|a| a.capacidade >= pessoas)
                .filter_map(|a| {
                    publicadas.get(&a.id).map(|p| BuscaAcomodacaoOut {
                        id: a.id,
                        slug: p.slug.clone(),
                        nome: p.nome.clone(),
                        numero: p.numero,
                        capacidade: a.capacidade,
                        valor: a.valor,
                    })
                })
                .collect();

            if !acomodacoes.is_empty() {
                alternativas.push(BuscaAlternativaOut {
                    inicio: c.inicio,
                    fim: c.fim,
                    noites: (c.fim - c.inicio).num_days().max(0) as u32,
                    deslocamento: c.deslocamento,
                    acomodacoes,
                });
            }
        }

        let aviso = (input.guests.pets > 0).then(|| {
            "A busca ainda não filtra unidades pet-friendly — confirme a política de animais com a recepção.".to_string()
        });

        Ok(BuscaPublicaResponse {
            com_disponibilidade: alternativas.len(),
            periodos: candidatos.len(),
            alternativas,
            aviso,
        })
    }
}

fn validar_hospedes(g: &BuscaHospedesInput) -> Result<i32, DomainError> {
    if g.adults < 1 {
        return Err(DomainError::validacao(
            "Informe ao menos um adulto para pesquisar.",
        ));
    }
    for (n, rotulo) in [
        (g.adults, "adultos"),
        (g.children, "crianças"),
        (g.infants, "bebês"),
        (g.pets, "animais"),
    ] {
        if n < 0 {
            return Err(DomainError::validacao(format!(
                "Quantidade de {rotulo} não pode ser negativa."
            )));
        }
    }
    // Bebês contam na capacidade física — sem isenção automática.
    let pessoas = g.adults + g.children + g.infants;
    if pessoas > MAX_PESSOAS {
        return Err(DomainError::validacao(format!(
            "Máximo de {MAX_PESSOAS} hóspedes por busca — para grupos maiores fale com a recepção."
        )));
    }
    Ok(pessoas)
}

fn gerar_candidatos(
    date: &BuscaDateInput,
    hoje: NaiveDate,
    horizonte: NaiveDate,
) -> Result<Vec<Candidato>, DomainError> {
    match date {
        BuscaDateInput::Dates {
            check_in,
            check_out,
            tolerance_days,
        } => gerar_com_tolerancia(*check_in, *check_out, *tolerance_days, hoje, horizonte),
        BuscaDateInput::Flexible {
            stay_preset,
            months,
        } => gerar_flexiveis(*stay_preset, months, hoje, horizonte),
    }
}

/// Desloca a viagem inteira -tolerância..=+tolerância preservando noites.
/// Ordem: exata, depois |deslocamento|, entrada mais próxima no desempate.
fn gerar_com_tolerancia(
    entrada: NaiveDate,
    saida: NaiveDate,
    tolerancia: i32,
    hoje: NaiveDate,
    horizonte: NaiveDate,
) -> Result<Vec<Candidato>, DomainError> {
    if saida <= entrada {
        return Err(DomainError::validacao(
            "A data de saída precisa ser posterior à data de entrada.",
        ));
    }
    if !TOLERANCIAS_VALIDAS.contains(&tolerancia) {
        return Err(DomainError::validacao(
            "Margem de dias inválida — use datas exatas, ±1, ±2, ±3, ±7 ou ±14.",
        ));
    }

    let mut vistos = BTreeSet::new();
    let mut candidatos = Vec::new();
    for d in -tolerancia..=tolerancia {
        let delta = Days::new(d.unsigned_abs() as u64);
        let (inicio, fim) = if d < 0 {
            match (
                entrada.checked_sub_days(delta),
                saida.checked_sub_days(delta),
            ) {
                (Some(i), Some(f)) => (i, f),
                _ => continue,
            }
        } else {
            match (
                entrada.checked_add_days(delta),
                saida.checked_add_days(delta),
            ) {
                (Some(i), Some(f)) => (i, f),
                _ => continue,
            }
        };

        // Datas passadas e entradas fora do horizonte saem da consulta.
        if inicio < hoje || inicio > horizonte {
            continue;
        }
        if vistos.insert((inicio, fim)) {
            candidatos.push(Candidato {
                inicio,
                fim,
                deslocamento: Some(d),
            });
        }
    }
    candidatos.sort_by_key(|c| (c.deslocamento.map(|d| d.abs()).unwrap_or(0), c.inicio));
    Ok(candidatos)
}

/// Mês selecionado gera entradas dia-a-dia (ou só sextas no `weekend`).
/// Ordem cronológica de entrada; meses duplicados não duplicam períodos.
fn gerar_flexiveis(
    preset: StayPresetInput,
    months: &[String],
    hoje: NaiveDate,
    horizonte: NaiveDate,
) -> Result<Vec<Candidato>, DomainError> {
    if months.is_empty() {
        return Err(DomainError::validacao(
            "Selecione ao menos um mês para a busca flexível.",
        ));
    }

    let mut meses = BTreeSet::new();
    for m in months {
        let (y, mo) = parse_mes(m)?;
        let primeiro = NaiveDate::from_ymd_opt(y, mo, 1)
            .ok_or_else(|| DomainError::validacao(format!("Mês inválido: {m}.")))?;
        if fim_do_mes(primeiro) < hoje {
            return Err(DomainError::validacao(
                "Não é possível pesquisar meses já passados.",
            ));
        }
        if primeiro > horizonte {
            return Err(DomainError::validacao(format!(
                "Mês {m} está além do horizonte de {HORIZONTE_MESES} meses."
            )));
        }
        meses.insert(primeiro);
    }
    if meses.len() > MAX_MESES_SELECIONADOS {
        return Err(DomainError::validacao(format!(
            "Selecione no máximo {MAX_MESES_SELECIONADOS} meses por busca."
        )));
    }

    let mut vistos = BTreeSet::new();
    let mut candidatos = Vec::new();
    for mes in &meses {
        let mut dia = *mes;
        while dia.month() == mes.month() {
            let entrada = dia;
            dia = dia.succ_opt().unwrap();

            if entrada < hoje {
                continue;
            }
            if preset == StayPresetInput::Weekend && entrada.weekday() != chrono::Weekday::Fri {
                continue;
            }

            let fim = match preset {
                StayPresetInput::Weekend => entrada + Days::new(2),
                StayPresetInput::Week => entrada + Days::new(7),
                StayPresetInput::Month => add_mes_calendario(entrada),
            };
            // Saída pode cruzar o mês — limite é o horizonte + 31 dias de
            // folga para estadias que nascem na borda do horizonte.
            if fim > horizonte + Days::new(31) {
                continue;
            }
            if vistos.insert((entrada, fim)) {
                candidatos.push(Candidato {
                    inicio: entrada,
                    fim,
                    deslocamento: None,
                });
            }
        }
    }
    Ok(candidatos)
}

/// `YYYY-MM` → (ano, mês). Rejeita qualquer outro formato.
fn parse_mes(m: &str) -> Result<(i32, u32), DomainError> {
    let mut partes = m.split('-');
    let (Some(y), Some(mo), None) = (partes.next(), partes.next(), partes.next()) else {
        return Err(DomainError::validacao(format!("Mês inválido: {m}.")));
    };
    if y.len() != 4 {
        return Err(DomainError::validacao(format!("Mês inválido: {m}.")));
    }
    match (y.parse::<i32>(), mo.parse::<u32>()) {
        (Ok(y), Ok(mo)) if (1..=12).contains(&mo) => Ok((y, mo)),
        _ => Err(DomainError::validacao(format!("Mês inválido: {m}."))),
    }
}

fn fim_do_mes(primeiro: NaiveDate) -> NaiveDate {
    primeiro
        .checked_add_months(Months::new(1))
        .unwrap()
        .pred_opt()
        .unwrap()
}

/// Um mês calendário a partir de `d`, ajustando ao último dia válido do
/// mês seguinte (31/01 → 28/02; 31/01 em ano bissexto → 29/02).
fn add_mes_calendario(d: NaiveDate) -> NaiveDate {
    d.checked_add_months(Months::new(1)).unwrap_or_else(|| {
        // chrono devolve None quando o dia não existe no mês alvo —
        // cai no último dia daquele mês.
        let (y, m) = if d.month() == 12 {
            (d.year() + 1, 1)
        } else {
            (d.year(), d.month() + 1)
        };
        fim_do_mes(NaiveDate::from_ymd_opt(y, m, 1).unwrap())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Weekday;

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn tolerancia_zero_um_periodo() {
        let c = gerar_com_tolerancia(
            d("2026-12-10"),
            d("2026-12-13"),
            0,
            d("2026-11-01"),
            d("2027-11-01"),
        )
        .unwrap();
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].inicio, d("2026-12-10"));
        assert_eq!(c[0].deslocamento, Some(0));
    }

    #[test]
    fn tolerancia_dois_cinco_periodos_mesmas_noites() {
        let c = gerar_com_tolerancia(
            d("2026-12-10"),
            d("2026-12-13"),
            2,
            d("2026-11-01"),
            d("2027-11-01"),
        )
        .unwrap();
        assert_eq!(c.len(), 5);
        for c in &c {
            assert_eq!((c.fim - c.inicio).num_days(), 3);
        }
        // exata primeiro, depois |deslocamento|
        assert_eq!(c[0].deslocamento, Some(0));
    }

    #[test]
    fn tolerancia_catorze_max_29_e_descarta_passado() {
        let c = gerar_com_tolerancia(
            d("2026-12-10"),
            d("2026-12-13"),
            14,
            d("2026-11-01"),
            d("2027-11-01"),
        )
        .unwrap();
        assert_eq!(c.len(), 29);
        // com "hoje" no meio da janela, os deslocamentos negativos que
        // caem no passado são removidos — sem rejeitar a busca inteira.
        let c2 = gerar_com_tolerancia(
            d("2026-12-10"),
            d("2026-12-13"),
            14,
            d("2026-12-10"),
            d("2027-11-01"),
        )
        .unwrap();
        assert!(c2.len() < 29);
        assert!(c2.iter().all(|c| c.inicio >= d("2026-12-10")));
    }

    #[test]
    fn tolerancia_invalida_rejeita() {
        assert!(gerar_com_tolerancia(
            d("2026-12-10"),
            d("2026-12-13"),
            5,
            d("2026-11-01"),
            d("2027-11-01")
        )
        .is_err());
        assert!(gerar_com_tolerancia(
            d("2026-12-13"),
            d("2026-12-10"),
            0,
            d("2026-11-01"),
            d("2027-11-01")
        )
        .is_err());
    }

    #[test]
    fn weekend_so_sextas_dois_noites() {
        let c = gerar_flexiveis(
            StayPresetInput::Weekend,
            &["2027-01".into()],
            d("2026-11-17"),
            d("2027-11-17"),
        )
        .unwrap();
        assert!(!c.is_empty());
        for c in &c {
            assert_eq!(c.inicio.weekday(), Weekday::Fri);
            assert_eq!((c.fim - c.inicio).num_days(), 2);
        }
    }

    #[test]
    fn week_sete_noites_cada_dia() {
        let c = gerar_flexiveis(
            StayPresetInput::Week,
            &["2027-01".into()],
            d("2026-11-17"),
            d("2027-11-17"),
        )
        .unwrap();
        assert_eq!(c.len(), 31);
        for c in &c {
            assert_eq!((c.fim - c.inicio).num_days(), 7);
        }
    }

    #[test]
    fn month_calendario_ajusta_fim_de_mes() {
        assert_eq!(add_mes_calendario(d("2027-01-31")), d("2027-02-28"));
        assert_eq!(add_mes_calendario(d("2028-01-31")), d("2028-02-29")); // bissexto
        assert_eq!(add_mes_calendario(d("2027-01-15")), d("2027-02-15"));
        assert_eq!(add_mes_calendario(d("2027-12-31")), d("2028-01-31"));
    }

    #[test]
    fn meses_duplicados_nao_duplicam_e_ordem_cronologica() {
        let c = gerar_flexiveis(
            StayPresetInput::Weekend,
            &["2027-01".into(), "2027-01".into()],
            d("2026-11-17"),
            d("2027-11-17"),
        )
        .unwrap();
        let unicos = c.len();
        let c2 = gerar_flexiveis(
            StayPresetInput::Weekend,
            &["2027-02".into(), "2027-01".into()],
            d("2026-11-17"),
            d("2027-11-17"),
        )
        .unwrap();
        assert!(c2.len() > unicos);
        for w in c2.windows(2) {
            assert!(w[0].inicio < w[1].inicio);
        }
    }

    #[test]
    fn mes_passado_e_invalido_rejeitam() {
        assert!(gerar_flexiveis(
            StayPresetInput::Week,
            &["2026-10".into()],
            d("2026-11-17"),
            d("2027-11-17"),
        )
        .is_err());
        assert!(gerar_flexiveis(
            StayPresetInput::Week,
            &["2027-13".into(), "abc".into()],
            d("2026-11-17"),
            d("2027-11-17"),
        )
        .is_err());
        assert!(
            gerar_flexiveis(StayPresetInput::Week, &[], d("2026-11-17"), d("2027-11-17")).is_err()
        );
    }

    #[test]
    fn hospedes_validacao() {
        assert!(validar_hospedes(&BuscaHospedesInput {
            adults: 0,
            children: 0,
            infants: 0,
            pets: 0,
        })
        .is_err());
        assert!(validar_hospedes(&BuscaHospedesInput {
            adults: 1,
            children: -1,
            infants: 0,
            pets: 0,
        })
        .is_err());
        assert_eq!(
            validar_hospedes(&BuscaHospedesInput {
                adults: 2,
                children: 1,
                infants: 1,
                pets: 2,
            })
            .unwrap(),
            4
        );
    }
}
