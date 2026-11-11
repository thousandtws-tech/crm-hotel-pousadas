//! Pré-reserva via WhatsApp — máquina de estados determinística por
//! telefone. A IA nunca toca em datas/dinheiro: intenção de reserva cai
//! aqui antes de chegar à Inná.
//!
//! Fluxo: intenção → datas → cotação real (`disponibilidade`) → nome →
//! confirmação explícita → reserva pendente (hold) + link oficial do
//! sinal (Stripe) ou, sem gateway, Pix manual conferido pela Recepção.

use std::sync::Arc;

use chrono::{Datelike, Duration, NaiveDate, Utc};
use clarituz_domain::enums::TipoPagamento;
use clarituz_domain::error::DomainError;
use clarituz_domain::ports::*;
use clarituz_domain::value_objects::PeriodoEstadia;
use clarituz_shared::money;
use rust_decimal::Decimal;
use serde_json::json;

use crate::dto::{CheckoutPublicoInput, ReservaPublicaInput};
use crate::error::AppResult;
use crate::services::{ComunicacaoService, PagamentosOnlineService, ReservaService};

/// Palavras que indicam intenção de reserva (forma verbal ou termo de
/// disponibilidade — "minha reserva" não casa: sem "reservar"/derivados).
const GATILHOS: &[&str] = &[
    "reservar",
    "quero reservar",
    "fazer uma reserva",
    "fazer reserva",
    "disponibil",
    "disponivel",
    "diaria",
    "diária",
    "quarto para",
    "quero hospedar",
    "hospedagem para",
];
const CANCELAR: &[&str] = &["cancelar", "desistir", "deixa pra la", "deixa pra lá"];
const CONFIRMAR: &[&str] = &["sim", "confirmo", "confirmar", "pode ser", "ok", "bora"];
const NEGAR: &[&str] = &["nao", "não", "cancelar", "desisto", "deixa"];

/// Tempo de vida da conversa de pré-reserva — abandono não trava o fluxo.
const EXPIRA_HORAS: i64 = 24;

pub struct PreReservaService {
    repo: Arc<dyn PreReservaRepository>,
    reservas_repo: Arc<dyn ReservaRepository>,
    reservas: Arc<ReservaService>,
    pagamentos: Arc<PagamentosOnlineService>,
    comunicacao: Arc<ComunicacaoService>,
    sinal_pct: u32,
}

impl PreReservaService {
    pub fn new(
        repo: Arc<dyn PreReservaRepository>,
        reservas_repo: Arc<dyn ReservaRepository>,
        reservas: Arc<ReservaService>,
        pagamentos: Arc<PagamentosOnlineService>,
        comunicacao: Arc<ComunicacaoService>,
        sinal_pct: u32,
    ) -> Self {
        Self {
            repo,
            reservas_repo,
            reservas,
            pagamentos,
            comunicacao,
            sinal_pct,
        }
    }

    /// `Some(texto)` quando a mensagem pertence ao fluxo de pré-reserva —
    /// o concierge enfileira a resposta e não chama a Inná.
    pub async fn processar(&self, telefone: &str, texto: &str) -> AppResult<Option<String>> {
        let t = normalizar(texto);
        let estado = self.repo.pre_reserva_obter(telefone).await?;

        if estado.is_some() && CANCELAR.iter().any(|c| t.contains(c)) {
            self.repo.pre_reserva_remover(telefone).await?;
            return Ok(Some(
                "Cancelei a pré-reserva — sem compromisso. Se mudar de ideia é só chamar! 😊"
                    .into(),
            ));
        }

        match estado.as_ref().map(|e| e.etapa.as_str()) {
            Some("datas") => self.etapa_datas(telefone, &t).await.map(Some),
            Some("nome") => self
                .etapa_nome(telefone, texto, estado.unwrap().dados)
                .await
                .map(Some),
            Some("confirmacao") => self
                .etapa_confirmacao(telefone, &t, estado.unwrap().dados)
                .await
                .map(Some),
            Some(_) => {
                self.repo.pre_reserva_remover(telefone).await?;
                Ok(None)
            }
            None => {
                if !GATILHOS.iter().any(|g| t.contains(g)) {
                    return Ok(None);
                }
                self.iniciar(telefone, &t).await.map(Some)
            }
        }
    }

    // ------------------------------------------------------------------
    // etapas
    // ------------------------------------------------------------------

    async fn iniciar(&self, tel: &str, t: &str) -> AppResult<String> {
        let datas = extrair_datas(t);
        if datas.len() >= 2 {
            return self.cotar(tel, t, datas[0], datas[1]).await;
        }
        self.salvar(tel, "datas", &json!({})).await?;
        Ok("Que ótimo! 😊 Para quais datas você quer se hospedar?\n\
            Ex.: *10/12 a 15/12*"
            .into())
    }

    async fn etapa_datas(&self, tel: &str, t: &str) -> AppResult<String> {
        let datas = extrair_datas(t);
        if datas.len() < 2 {
            return Ok("Não consegui entender as datas — me manda no formato \
                *10/12 a 15/12* (check-in e check-out)?"
                .into());
        }
        self.cotar(tel, t, datas[0], datas[1]).await
    }

    /// Cotação real contra `disponibilidade`; guarda a oferta no estado.
    async fn cotar(
        &self,
        tel: &str,
        t: &str,
        entrada: NaiveDate,
        saida: NaiveDate,
    ) -> AppResult<String> {
        if saida <= entrada {
            self.salvar(tel, "datas", &json!({})).await?;
            return Ok("A saída precisa ser depois da entrada — me manda as datas de novo?".into());
        }
        let periodo = PeriodoEstadia::new(entrada, saida)
            .map_err(|_| DomainError::validacao("período inválido"))?;
        let hospedes = extrair_hospedes(t).unwrap_or(2);
        let livres = self
            .reservas_repo
            .disponibilidade(periodo, Some(hospedes), None, None)
            .await?;
        let Some(a) = livres
            .iter()
            .filter(|x| x.capacidade >= hospedes)
            .min_by_key(|x| x.valor)
        else {
            self.salvar(tel, "datas", &json!({})).await?;
            return Ok(format!(
                "Não tenho disponibilidade de {} a {}. \
                Quer tentar outras datas?",
                fmt_data(entrada),
                fmt_data(saida)
            ));
        };
        let noites = Decimal::from((saida - entrada).num_days().max(1));
        let total = money::round2(a.valor * noites);
        let sinal = money::round2(total * Decimal::from(self.sinal_pct) / Decimal::from(100));
        let dados = json!({
            "idacomodacao": a.id, "acomodacao": a.nome,
            "check_in": entrada.to_string(), "check_out": saida.to_string(),
            "hospedes": hospedes, "valor_total": total.to_string(),
            "sinal": sinal.to_string(),
        });
        self.salvar(tel, "nome", &dados).await?;
        Ok(format!(
            "Tenho *{}* livre de {} a {} para {} pessoa(s)!\n\n\
            Total: *R$ {}* ({} noite(s))\n\
            Sinal de {}%: *R$ {}*\n\n\
            Pra seguir, me diz seu *nome completo*?",
            a.nome,
            fmt_data(entrada),
            fmt_data(saida),
            hospedes,
            total,
            (saida - entrada).num_days().max(1),
            self.sinal_pct,
            sinal,
        ))
    }

    async fn etapa_nome(
        &self,
        tel: &str,
        nome: &str,
        mut dados: serde_json::Value,
    ) -> AppResult<String> {
        let nome = nome.trim();
        if nome.split_whitespace().count() < 2 || nome.len() < 5 {
            return Ok("Preciso do nome completo (nome e sobrenome) pra reserva.".into());
        }
        dados["nome"] = json!(nome);
        self.salvar(tel, "confirmacao", &dados).await?;
        Ok(format!(
            "Obrigado, {}! Confirma a reserva de *{}* ({} → {}) por *R$ {}* \
            com sinal de *R$ {}*?\n\
            Ao confirmar você aceita a política de cancelamento e de privacidade.\n\n\
            Responda *SIM* ou *NÃO*.",
            nome.split_whitespace().next().unwrap_or(nome),
            dados["acomodacao"].as_str().unwrap_or_default(),
            fmt_data(parse_data(dados["check_in"].as_str().unwrap_or_default())),
            fmt_data(parse_data(dados["check_out"].as_str().unwrap_or_default())),
            dados["valor_total"].as_str().unwrap_or_default(),
            dados["sinal"].as_str().unwrap_or_default(),
        ))
    }

    async fn etapa_confirmacao(
        &self,
        tel: &str,
        t: &str,
        dados: serde_json::Value,
    ) -> AppResult<String> {
        if NEGAR.contains(&t) {
            self.repo.pre_reserva_remover(tel).await?;
            return Ok("Tudo bem — cancelei a pré-reserva. 😊".into());
        }
        if !CONFIRMAR.contains(&t) {
            return Ok("Responda *SIM* pra confirmar ou *NÃO* pra cancelar.".into());
        }

        let out = self
            .reservas
            .criar_reserva_site(
                ReservaPublicaInput {
                    slug: None,
                    idacomodacao: dados["idacomodacao"].as_i64(),
                    check_in: parse_data(dados["check_in"].as_str().unwrap_or_default()),
                    check_out: parse_data(dados["check_out"].as_str().unwrap_or_default()),
                    hospedes: dados["hospedes"].as_i64().unwrap_or(2) as i32,
                    nome: dados["nome"].as_str().unwrap_or_default().to_string(),
                    // E-mail sintético por telefone — hóspede recorrente
                    // reencontra o próprio cadastro sem pedir e-mail.
                    email: format!("wa{tel}@whatsapp.local"),
                    telefone: tel.to_string(),
                    cpf: None,
                    observacoes: Some("Pré-reserva via WhatsApp (Inná)".into()),
                    early_checkin: None,
                    late_checkout: None,
                    aceito_termos: true,
                    aceito_marketing: false,
                },
                Some(&format!("whatsapp:{tel}")),
            )
            .await?;

        if out.status != "reserva_criada" {
            self.repo.pre_reserva_remover(tel).await?;
            return Ok(format!("{} Quer tentar outras datas?", out.mensagem));
        }
        self.repo.pre_reserva_remover(tel).await?;
        let idr = out.idreserva.unwrap_or_default();

        // Link oficial do sinal — Stripe; sem gateway, Pix manual pela Recepção.
        let token = out.token_publico.unwrap_or_default();
        match self
            .pagamentos
            .criar_checkout_publico(CheckoutPublicoInput {
                token,
                tipo: TipoPagamento::Sinal,
            })
            .await
        {
            Ok(c) => {
                self.aviso(tel, idr, "link de sinal enviado").await;
                Ok(format!(
                    "Reserva *#{idr}* confirmada! 🎉\n\n\
                    Pra garantir, pague o sinal de *R$ {}* neste link seguro:\n{}\n\n\
                    O link vale por 30 min — depois a vaga libera de novo.",
                    dados["sinal"].as_str().unwrap_or_default(),
                    c.checkout_url,
                ))
            }
            Err(e) => {
                tracing::warn!(erro = %e, "pre_reserva: checkout falhou — Pix manual");
                self.aviso(tel, idr, "enviar chave Pix e conferir pagamento")
                    .await;
                Ok(format!(
                    "Reserva *#{idr}* registrada! 🎉\n\n\
                    Nossa recepção já vai te mandar a chave Pix do sinal \
                    (*R$ {}*) e confirma o pagamento por aqui.",
                    dados["sinal"].as_str().unwrap_or_default(),
                ))
            }
        }
    }

    // ------------------------------------------------------------------

    async fn salvar(&self, tel: &str, etapa: &str, dados: &serde_json::Value) -> AppResult<()> {
        self.repo
            .pre_reserva_salvar(
                tel,
                etapa,
                dados,
                Utc::now() + Duration::hours(EXPIRA_HORAS),
            )
            .await?;
        Ok(())
    }

    async fn aviso(&self, tel: &str, idreserva: i64, acao: &str) {
        if let Err(e) = self
            .comunicacao
            .avisar_equipe(
                "pre_reserva",
                "Pré-reserva criada pelo WhatsApp",
                &format!("Reserva #{idreserva} (+{tel}) — {acao}."),
                Some(idreserva),
            )
            .await
        {
            tracing::warn!(erro = %e, "pre_reserva: aviso à equipe falhou");
        }
    }
}

// ---------------------------------------------------------------------------
// parsing — determinístico, sem regex: dígitos separados por '/' ou '-'.
// ---------------------------------------------------------------------------

fn normalizar(t: &str) -> String {
    t.trim().to_lowercase()
}

/// Extrai pares de datas `dd/mm` ou `dd/mm/aaaa` na ordem do texto.
fn extrair_datas(t: &str) -> Vec<NaiveDate> {
    let mut out = Vec::new();
    let b = t.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i].is_ascii_digit() {
            let ini = i;
            let mut j = i;
            while j < b.len() && (b[j].is_ascii_digit() || b[j] == b'/' || b[j] == b'-') {
                j += 1;
            }
            if let Some(d) = parse_pedaco(&t[ini..j]) {
                out.push(d);
            }
            i = j.max(i + 1);
        } else {
            i += 1;
        }
    }
    out
}

/// "10/12", "10/12/26", "10/12/2026" → data futura mais próxima.
fn parse_pedaco(s: &str) -> Option<NaiveDate> {
    let partes: Vec<i64> = s
        .split(['/', '-'])
        .filter_map(|p| p.trim().parse().ok())
        .collect();
    if !(2..=3).contains(&partes.len()) {
        return None;
    }
    let (d, m) = (
        u32::try_from(partes[0]).ok()?,
        u32::try_from(partes[1]).ok()?,
    );
    if !(1..=31).contains(&d) || !(1..=12).contains(&m) {
        return None;
    }
    let hoje = Utc::now().date_naive();
    let mut ano = match partes.get(2) {
        Some(&a) if a >= 100 => i32::try_from(a).ok()?,
        Some(&a) => i32::try_from(2000 + a).ok()?,
        None => hoje.year(),
    };
    let mut data = NaiveDate::from_ymd_opt(ano, m, d)?;
    if data < hoje && partes.get(2).is_none() {
        ano += 1;
        data = NaiveDate::from_ymd_opt(ano, m, d)?;
    }
    Some(data)
}

fn parse_data(s: &str) -> NaiveDate {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap_or_else(|_| Utc::now().date_naive())
}

fn fmt_data(d: NaiveDate) -> String {
    d.format("%d/%m").to_string()
}

/// "para 4 pessoas", "2 hóspedes", "3 adultos" → nº de hóspedes.
fn extrair_hospedes(t: &str) -> Option<i32> {
    let palavras = ["pessoa", "hóspede", "hospede", "adulto", "gente"];
    let toks: Vec<&str> = t.split_whitespace().collect();
    toks.iter()
        .position(|w| palavras.iter().any(|p| w.starts_with(p)))
        .and_then(|i| i.checked_sub(1))
        .and_then(|i| toks[i].parse().ok())
        .filter(|&n: &i32| (1..=20).contains(&n))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extrai_duas_datas() {
        let v = extrair_datas("quero reservar de 10/12 a 15/12 para 2 pessoas");
        assert_eq!(v.len(), 2);
        assert_eq!((v[0].day(), v[0].month()), (10, 12));
        assert_eq!((v[1].day(), v[1].month()), (15, 12));
    }

    #[test]
    fn hospedes_do_texto() {
        assert_eq!(extrair_hospedes("quarto para 4 pessoas"), Some(4));
        assert_eq!(extrair_hospedes("2 adultos e 1 criança"), Some(2));
        assert_eq!(extrair_hospedes("sem numero"), None);
    }

    #[test]
    fn gatilhos_nao_pegam_minha_reserva() {
        let t = normalizar("qual o status da minha reserva?");
        assert!(!GATILHOS.iter().any(|g| t.contains(g)));
        let t2 = normalizar("quero reservar um quarto");
        assert!(GATILHOS.iter().any(|g| t2.contains(g)));
    }
}
