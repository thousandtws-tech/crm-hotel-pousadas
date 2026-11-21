use std::sync::Arc;

use chrono::{Duration, Timelike, Utc};
use clarituz_domain::ports::*;
use clarituz_domain::DomainError;

use crate::error::AppResult;
use crate::services::ComunicacaoService;

const URGENCIA: &[&str] = &[
    "urgente",
    "emergencia",
    "emergência",
    "fogo",
    "incendio",
    "incêndio",
    "vazamento de gas",
    "vazamento de gás",
    "fumaca",
    "fumaça",
    "acidente",
    "machucad",
    "sangr",
    "seguranca",
    "segurança",
    "invad",
    "ladrao",
    "ladrão",
    "sem luz",
    "sem energia",
    "desmai",
    "passando mal",
];
/// Manutenção — estrutura/equipamentos do quarto.
const MANUTENCAO: &[&str] = &[
    "vazament",
    "chuveiro",
    "ar condicion",
    "ar-condicion",
    "lampada",
    "lâmpada",
    "televis",
    "tomada",
    "torneira",
    "descarga",
    "privada",
    "vaso sanit",
    "fechadura",
    "aquecedor",
    "infiltra",
    "goteira",
    "quebrad",
    "nao funciona",
    "não funciona",
    "nao liga",
    "não liga",
    "porta emperr",
    "barulho no ar",
];
/// Governança — limpeza, enxoval, amenidades, frigobar.
const GOVERNANCA: &[&str] = &[
    "toalha",
    "lencol",
    "lençol",
    "limpeza",
    "sujo",
    "suja",
    "limpar",
    "amenit",
    "sabonete",
    "shampoo",
    "travesseir",
    "cobertor",
    "manta",
    "lixo",
    "frigobar",
    "arrumar",
    "arrumaç",
    "berço",
    "berco",
    "papel higi",
];

/// Resultado da abertura — o concierge usa pra compor a resposta ao hóspede.
pub struct AberturaAtendimento {
    pub protocolo: String,
    pub setor: String,
    pub urgente: bool,
    /// Fora do horário e não-urgente → avisar "respondemos às HH:MM".
    pub fora_horario: bool,
    /// "HH:MM" de abertura (só relevante quando `fora_horario`).
    pub abre_as: String,
}

pub struct AtendimentoService {
    repo: Arc<dyn AtendimentoRepository>,
    comunicacao: Arc<ComunicacaoService>,
    sla_aceite_min: i64,
    /// Janela local (UTC-3) de atendimento — urgências furam a fila.
    abre: (u32, u32),
    fecha: (u32, u32),
}

impl AtendimentoService {
    pub fn new(
        repo: Arc<dyn AtendimentoRepository>,
        comunicacao: Arc<ComunicacaoService>,
        sla_aceite_min: u32,
        horario: &str,
    ) -> Self {
        let (abre, fecha) = parse_janela(horario);
        Self {
            repo,
            comunicacao,
            sla_aceite_min: sla_aceite_min as i64,
            abre,
            fecha,
        }
    }

    /// Classifica, persiste e notifica. Retorna o que o concierge precisa
    /// pra responder o hóspede ("protocolo A-123", "emergência acionada").
    pub async fn abrir(
        &self,
        origem: &str,
        r: &ReservaAuto,
        msg: &str,
        motivo: Option<&str>,
    ) -> AppResult<AberturaAtendimento> {
        let assunto = format!(
            "Escalada Maria — {}",
            r.cliente_nome
                .split_whitespace()
                .next()
                .unwrap_or(&r.cliente_nome)
        );
        self.registrar(
            origem,
            r.cliente_telefone.as_deref(),
            Some(r.idreserva),
            Some(r.idcliente),
            &assunto,
            msg,
            motivo,
        )
        .await
    }

    /// Menu "3-Atendente" e outros contatos sem reserva vinculada —
    /// protocolo cai na recepção com o telefone pra retorno.
    pub async fn abrir_telefone(
        &self,
        origem: &str,
        telefone: &str,
        msg: &str,
        motivo: Option<&str>,
    ) -> AppResult<AberturaAtendimento> {
        self.registrar(
            origem,
            Some(telefone),
            None,
            None,
            "WhatsApp — pediu atendente",
            msg,
            motivo,
        )
        .await
    }

    /// Núcleo compartilhado: classifica urgência/setor, grava o protocolo
    /// e avisa a equipe. `idreserva`/`idcliente` são None sem reserva.
    async fn registrar(
        &self,
        origem: &str,
        telefone: Option<&str>,
        idreserva: Option<i64>,
        idcliente: Option<i64>,
        assunto: &str,
        msg: &str,
        motivo: Option<&str>,
    ) -> AppResult<AberturaAtendimento> {
        let (setor, prioridade) = classificar(msg);
        let urgente = prioridade == "urgente";
        let setor = if urgente { "recepcao" } else { setor };
        let a = self
            .repo
            .atendimento_abrir(&NovoAtendimento {
                origem: origem.to_string(),
                setor: setor.to_string(),
                prioridade: prioridade.to_string(),
                telefone: telefone.map(String::from),
                idreserva,
                idcliente,
                assunto: assunto.to_string(),
                ultima_msg: Some(msg.chars().take(200).collect()),
                motivo: motivo.map(String::from),
                prazo_aceite: Utc::now() + Duration::minutes(self.sla_aceite_min),
            })
            .await?;

        let fora = !urgente && !self.dentro_horario();
        let (evento, titulo) = if urgente {
            ("atendimento.urgente", "URGENTE — atendimento imediato")
        } else if fora {
            ("atendimento.novo", "Atendimento fora do horário")
        } else {
            ("atendimento.novo", "Novo atendimento na fila")
        };
        let reserva_txt = idreserva.map_or_default(|r| format!("reserva #{r} · "));
        if let Err(e) = self
            .comunicacao
            .avisar_equipe(
                evento,
                titulo,
                &format!(
                    "Protocolo {} · {reserva_txt}setor {setor} · {origem}: {}",
                    a.protocolo,
                    msg.chars().take(140).collect::<String>(),
                ),
                idreserva,
            )
            .await
        {
            tracing::warn!(erro = %e, "atendimento: aviso falhou");
        }

        Ok(AberturaAtendimento {
            protocolo: a.protocolo,
            setor: setor.to_string(),
            urgente,
            fora_horario: fora,
            abre_as: format!("{:02}:{:02}", self.abre.0, self.abre.1),
        })
    }

    /// Worker: tudo `aberto` com SLA vencido escala pra gerência.
    /// Idempotente (`atendimento_escalar` só move `aberto`→`escalado`).
    pub async fn sweep(&self) -> AppResult<u32> {
        let mut n = 0;
        for a in self.repo.atendimento_vencidos().await? {
            self.repo.atendimento_escalar(a.id).await?;
            n += 1;
            if let Err(e) = self
                .comunicacao
                .avisar_equipe(
                    "atendimento.escalado",
                    "Protocolo sem aceite no SLA — escalado",
                    &format!(
                        "Protocolo {} (setor {}, {}) passou {}min sem aceite: {}",
                        a.protocolo, a.setor, a.origem, self.sla_aceite_min, a.assunto,
                    ),
                    a.idreserva,
                )
                .await
            {
                tracing::warn!(erro = %e, "atendimento: aviso de escalada falhou");
            }
        }
        Ok(n)
    }

    /// Fila para a tela admin (`status`: aberto|em_atendimento|escalado|resolvido).
    pub async fn fila(&self, status: &str, setor: Option<&str>) -> AppResult<Vec<Atendimento>> {
        Ok(self.repo.atendimento_fila(status, setor).await?)
    }

    /// Recepção/gerência assume o protocolo.
    pub async fn aceitar(&self, id: i64, idfuncionario: i64) -> AppResult<Atendimento> {
        Ok(self.repo.atendimento_aceitar(id, idfuncionario).await?)
    }

    pub async fn resolver(&self, id: i64, idfuncionario: i64) -> AppResult<Atendimento> {
        Ok(self.repo.atendimento_resolver(id, idfuncionario).await?)
    }

    /// Transferência entre setores — volta à fila com SLA de aceite renovado.
    pub async fn transferir(
        &self,
        id: i64,
        setor: &str,
        _idfuncionario: i64,
    ) -> AppResult<Atendimento> {
        const SETORES: [&str; 4] = ["recepcao", "governanca", "manutencao", "gerencia"];
        if !SETORES.contains(&setor) {
            return Err(DomainError::validacao("Setor inválido.").into());
        }
        let prazo = Utc::now() + Duration::minutes(self.sla_aceite_min);
        Ok(self.repo.atendimento_transferir(id, setor, prazo).await?)
    }

    /// Nota interna — contexto de turno; nunca sai pro hóspede.
    pub async fn anotar(
        &self,
        id: i64,
        texto: &str,
        idfuncionario: i64,
    ) -> AppResult<AtendimentoNota> {
        let texto = texto.trim();
        if texto.is_empty() || texto.len() > 2000 {
            return Err(DomainError::validacao("Nota vazia ou muito longa.").into());
        }
        Ok(self
            .repo
            .atendimento_anotar(id, idfuncionario, texto)
            .await?)
    }

    pub async fn notas(&self, id: i64) -> AppResult<Vec<AtendimentoNota>> {
        Ok(self.repo.atendimento_notas(id).await?)
    }

    /// Etiquetas livres — normalizadas (minúsculas, sem vazias, dedup, máx. 8).
    pub async fn salvar_tags(&self, id: i64, tags: &[String]) -> AppResult<Atendimento> {
        let mut limpas: Vec<String> = Vec::new();
        for t in tags {
            let t = t.trim().to_lowercase();
            if !t.is_empty() && t.len() <= 24 && !limpas.contains(&t) {
                limpas.push(t);
            }
        }
        limpas.truncate(8);
        Ok(self.repo.atendimento_tags(id, &limpas).await?)
    }

    /// Mensagem de WhatsApp agendada pro telefone do protocolo
    /// ("lembrete checkout amanhã 10h") — `fila_envio.agendado_para`.
    pub async fn agendar_mensagem(
        &self,
        id: i64,
        texto: &str,
        quando: chrono::DateTime<Utc>,
    ) -> AppResult<()> {
        let texto = texto.trim();
        if texto.is_empty() || texto.len() > 1000 {
            return Err(DomainError::validacao("Mensagem vazia ou muito longa.").into());
        }
        if quando <= Utc::now() {
            return Err(DomainError::validacao("Agende para o futuro.").into());
        }
        let a = self
            .repo
            .atendimento_buscar(id)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("atendimento não encontrado"))?;
        let fone = a
            .telefone
            .ok_or_else(|| DomainError::validacao("Protocolo sem telefone vinculado."))?;
        self.comunicacao
            .enviar_whatsapp_texto(&fone, texto, quando, a.idreserva, a.idcliente)
            .await
    }

    /// Relatório do período — tempo de resposta, SLA e volumes por
    /// setor/origem. `None` = últimos 30 dias; teto de 1 ano.
    pub async fn relatorio(
        &self,
        inicio: Option<chrono::DateTime<Utc>>,
        fim: Option<chrono::DateTime<Utc>>,
    ) -> AppResult<AtendimentoRelatorio> {
        let fim = fim.unwrap_or_else(Utc::now);
        let inicio = inicio.unwrap_or_else(|| fim - Duration::days(30));
        if inicio >= fim || fim - inicio > Duration::days(366) {
            return Err(DomainError::validacao("Período inválido (máx. 1 ano).").into());
        }
        Ok(self.repo.atendimento_relatorio(inicio, fim).await?)
    }

    /// Janela de atendimento em horário local da pousada (UTC-3).
    fn dentro_horario(&self) -> bool {
        let agora = Utc::now() - Duration::hours(3);
        let min = agora.hour() * 60 + agora.minute();
        let (a, f) = (
            self.abre.0 * 60 + self.abre.1,
            self.fecha.0 * 60 + self.fecha.1,
        );
        if a <= f {
            min >= a && min < f
        } else {
            min >= a || min < f // janela que cruza meia-noite
        }
    }
}

/// Palavra-chave → (setor, prioridade). Urgência vence setor.
fn classificar(texto: &str) -> (&'static str, &'static str) {
    let t = texto.to_lowercase();
    if URGENCIA.iter().any(|k| t.contains(k)) {
        return ("recepcao", "urgente");
    }
    if MANUTENCAO.iter().any(|k| t.contains(k)) {
        return ("manutencao", "normal");
    }
    if GOVERNANCA.iter().any(|k| t.contains(k)) {
        return ("governanca", "normal");
    }
    ("recepcao", "normal")
}

/// "07:00-22:30" → ((7,0),(22,30)); formato inválido cai no default.
fn parse_janela(s: &str) -> ((u32, u32), (u32, u32)) {
    let hm = |p: &str| -> Option<(u32, u32)> {
        let mut it = p.trim().split(':');
        let h: u32 = it.next()?.parse().ok()?;
        let m: u32 = it.next().unwrap_or("0").parse().ok()?;
        (h < 24 && m < 60).then_some((h, m))
    };
    s.split_once('-')
        .and_then(|(a, b)| hm(a).zip(hm(b)))
        .unwrap_or(((7, 0), (22, 0)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urgencia_sempre_recepcao() {
        assert_eq!(
            classificar("tem vazamento de gás no quarto"),
            ("recepcao", "urgente")
        );
        assert_eq!(classificar("estou passando mal"), ("recepcao", "urgente"));
    }

    #[test]
    fn setor_por_palavra_chave() {
        assert_eq!(
            classificar("o chuveiro nao esquenta"),
            ("manutencao", "normal")
        );
        assert_eq!(
            classificar("preciso de mais toalhas"),
            ("governanca", "normal")
        );
        assert_eq!(classificar("quero pagar o saldo"), ("recepcao", "normal"));
    }

    #[test]
    fn janela_parsing() {
        assert_eq!(parse_janela("07:00-22:30"), ((7, 0), (22, 30)));
        assert_eq!(parse_janela("lixo"), ((7, 0), (22, 0)));
    }
}
