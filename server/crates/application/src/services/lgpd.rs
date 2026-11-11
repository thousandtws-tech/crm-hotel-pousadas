//! LGPD 13.709/18 — consentimento, opt-out, direitos do titular (art. 18),
//! aceite de termos (CDC) e retenção com anonimização (art. 16).
//!
//! Templates não-transacionais (pesquisa, campanhas) respeitam opt-out;
//! transacionais (FNRH, cobrança, operação da estadia) seguem sempre —
//! base legal = execução de contrato.

use std::sync::Arc;

use clarituz_domain::entities::NovoLog;
use clarituz_domain::error::DomainError;
use clarituz_domain::events::{Aviso, TipoAviso};
use clarituz_domain::ports::*;

use crate::actor::Ator;
use crate::error::AppResult;

/// Templates que param quando o titular faz opt-out — comunicação de
/// serviço/marketing. Transacional da estadia nunca é suprimido.
pub const TEMPLATES_SUPRIMIVEIS: &[&str] = &["pesquisa", "pesquisa_lembrete", "campanha", "promo"];

/// Comandos de opt-out aceitos no bot (canal 'whatsapp').
pub const OPT_OUT_PALAVRAS: &[&str] = &[
    "sair",
    "parar",
    "stop",
    "descadastrar",
    "remover",
    "cancelar mensagens",
];

pub struct LgpdService {
    repo: Arc<dyn LgpdRepository>,
    eventos: Arc<dyn EventoPublisher>,
    logs: Arc<dyn LogRepository>,
}

impl LgpdService {
    pub fn new(
        repo: Arc<dyn LgpdRepository>,
        eventos: Arc<dyn EventoPublisher>,
        logs: Arc<dyn LogRepository>,
    ) -> Self {
        Self {
            repo,
            eventos,
            logs,
        }
    }

    /// Mensagem do bot é pedido de opt-out? ("sair", "parar", …)
    pub fn eh_opt_out(texto: &str) -> bool {
        let t = texto.trim().to_lowercase();
        OPT_OUT_PALAVRAS.iter().any(|p| t == *p)
    }

    pub async fn opt_out_telefone(&self, telefone: &str, canal: &str) -> AppResult<u64> {
        Ok(self.repo.opt_out_telefone(telefone, canal).await?)
    }

    pub async fn opt_out_cliente(&self, idcliente: i64, canal: &str) -> AppResult<()> {
        Ok(self.repo.opt_out_cliente(idcliente, canal).await?)
    }

    /// Checa supressão antes de enviar template não-transacional.
    pub async fn suprimido(&self, idcliente: Option<i64>, template: &str) -> AppResult<bool> {
        if !TEMPLATES_SUPRIMIVEIS.contains(&template) {
            return Ok(false);
        }
        Ok(match idcliente {
            Some(id) => self.repo.cliente_opt_out(id).await?,
            None => false,
        })
    }

    pub async fn registrar_consent(&self, idcliente: i64) -> AppResult<()> {
        Ok(self.repo.registrar_consent(idcliente).await?)
    }

    /// CDC — aceite da política de cancelamento + privacidade (data e IP).
    pub async fn marcar_termos(&self, idreserva: i64, ip: &str) -> AppResult<()> {
        Ok(self.repo.marcar_termos(idreserva, ip).await?)
    }

    /// ECA — autorização dos pais p/ menor desacompanhado (doc referência).
    pub async fn marcar_autorizacao_menor(&self, idreserva: i64, doc: &str) -> AppResult<()> {
        Ok(self.repo.marcar_autorizacao_menor(idreserva, doc).await?)
    }

    /// Acesso do titular — todos os dados pessoais (art. 18, II).
    /// `ator` = `Some` no caminho admin (quem exportou), `None` no
    /// portal (o próprio titular). O acesso é inventariado na trilha —
    /// Decreto 8.771/16, art. 13, III.
    pub async fn exportar_cliente(
        &self,
        ator: Option<&Ator>,
        idcliente: i64,
    ) -> AppResult<serde_json::Value> {
        self.logs
            .inserir(NovoLog {
                idfuncionario: ator.map(|a| a.id),
                acao: "lgpd:exportacao".into(),
                obs: format!(
                    "Exportação dos dados do titular #{idcliente} ({}).",
                    ator.map_or_else(|| "portal do titular".to_string(), |a| a.nome.clone())
                ),
                tabela: "cliente",
                idtabela: idcliente,
                dados: Some(serde_json::json!({
                    "canal": if ator.is_some() { "admin" } else { "portal" },
                })),
            })
            .await?;
        Ok(self.repo.exportar_cliente(idcliente).await?)
    }

    /// Eliminação — anonimiza preservando trilha legal (art. 16).
    /// Executada via solicitação do titular ou pela retenção.
    pub async fn anonimizar_cliente(&self, ator: &Ator, idcliente: i64) -> AppResult<()> {
        self.repo.anonimizar_cliente(idcliente).await?;
        self.logs
            .inserir(NovoLog {
                idfuncionario: Some(ator.id),
                acao: "lgpd:anonimizacao".into(),
                obs: format!(
                    "{} anonimizou o titular #{idcliente} — trilha fiscal/FNRH preservada.",
                    ator.nome
                ),
                tabela: "cliente",
                idtabela: idcliente,
                dados: None,
            })
            .await?;
        self.eventos.avisar(
            Aviso::novo(
                TipoAviso::Info,
                "Titular anonimizado (LGPD)",
                format!(
                    "Cliente #{idcliente} anonimizado por {} — trilha fiscal/FNRH preservada.",
                    ator.nome
                ),
            )
            .de_ator(ator.id, &ator.nome),
        );
        Ok(())
    }

    /// Retenção — cron diário: clientes sem estadia há `anos`.
    pub async fn anonimizar_vencidos(&self, anos: i32) -> AppResult<u64> {
        let n = self.repo.anonimizar_vencidos(anos).await?;
        if n > 0 {
            tracing::info!(anonimizados = n, "lgpd: retenção — titulares anonimizados");
        }
        Ok(n)
    }

    /// Nova solicitação do titular — avisa a equipe pra tratar no prazo
    /// legal (15 dias, art. 19).
    pub async fn solicitar(
        &self,
        idcliente: Option<i64>,
        idreserva: Option<i64>,
        tipo: &str,
        detalhe: Option<&str>,
        canal: &str,
    ) -> AppResult<i64> {
        const TIPOS: &[&str] = &[
            "acesso",
            "retificacao",
            "eliminacao",
            "portabilidade",
            "revogacao",
        ];
        if !TIPOS.contains(&tipo) {
            return Err(DomainError::validacao(format!("tipo inválido: {tipo}")).into());
        }
        let id = self
            .repo
            .criar_solicitacao(idcliente, idreserva, tipo, detalhe, canal)
            .await?;
        self.eventos.avisar(
            Aviso::novo(
                TipoAviso::Alerta,
                "Solicitação LGPD do titular",
                format!("Nova solicitação de {tipo} (protocolo #{id}) — responder em até 15 dias."),
            )
            .dados(serde_json::json!({"lgpd_solicitacao": id, "tipo": tipo})),
        );
        Ok(id)
    }

    pub async fn listar_solicitacoes(
        &self,
        status: Option<&str>,
    ) -> AppResult<Vec<LgpdSolicitacao>> {
        Ok(self.repo.listar_solicitacoes(status).await?)
    }

    pub async fn responder_solicitacao(
        &self,
        ator: &Ator,
        id: i64,
        resposta: &str,
    ) -> AppResult<()> {
        Ok(self
            .repo
            .responder_solicitacao(id, resposta, ator.id)
            .await?)
    }

    /// Rotina diária — solicitações 'aberta' além do prazo legal de
    /// resposta (15 dias, art. 19) viram alerta para a equipe. Retorna
    /// quantas estão vencidas.
    pub async fn alertar_solicitacoes_vencidas(&self) -> AppResult<u64> {
        const PRAZO_LEGAL_DIAS: i32 = 15;
        let vencidas = self.repo.solicitacoes_vencidas(PRAZO_LEGAL_DIAS).await?;
        if vencidas.is_empty() {
            return Ok(0);
        }
        let ids: Vec<String> = vencidas.iter().map(|s| format!("#{}", s.id)).collect();
        self.eventos.avisar(
            Aviso::novo(
                TipoAviso::Alerta,
                "Solicitações LGPD vencidas",
                format!(
                    "{} solicitação(ões) do titular sem resposta há mais de 15 dias \
                     (art. 19): {}.",
                    vencidas.len(),
                    ids.join(", ")
                ),
            )
            .dados(
                serde_json::json!({"protocolos": vencidas.iter().map(|s| s.id)
                .collect::<Vec<_>>()}),
            ),
        );
        Ok(vencidas.len() as u64)
    }

    /// Art. 48 — registro de incidente de segurança que possa acarretar
    /// risco ou dano relevante aos titulares. Documenta o fato para a
    /// comunicação à ANPD e aos titulares.
    pub async fn registrar_incidente(&self, ator: &Ator, novo: NovoIncidente) -> AppResult<i64> {
        ator.exigir_admin()?;
        if novo.descricao.trim().is_empty() {
            return Err(DomainError::validacao("Descreva o incidente.").into());
        }
        if let Some(r) = novo.risco.as_deref() {
            if !["baixo", "medio", "alto"].contains(&r) {
                return Err(DomainError::validacao("risco inválido: baixo|medio|alto").into());
            }
        }
        let id = self.repo.criar_incidente(&novo, ator.id).await?;
        self.logs
            .inserir(NovoLog {
                idfuncionario: Some(ator.id),
                acao: "lgpd:incidente".into(),
                obs: format!("{} registrou o incidente de segurança #{id}.", ator.nome),
                tabela: "lgpd_incidente",
                idtabela: id,
                dados: None,
            })
            .await?;
        self.eventos.avisar(
            Aviso::novo(
                TipoAviso::Alerta,
                "Incidente de segurança (LGPD art. 48)",
                format!(
                    "Incidente #{id} registrado — avalie a comunicação à ANPD e aos titulares."
                ),
            )
            .de_ator(ator.id, &ator.nome)
            .dados(serde_json::json!({"lgpd_incidente": id})),
        );
        Ok(id)
    }

    pub async fn listar_incidentes(&self, ator: &Ator) -> AppResult<Vec<LgpdIncidente>> {
        ator.exigir_admin()?;
        Ok(self.repo.listar_incidentes().await?)
    }

    /// Marca a comunicação do incidente — `destino` = 'anpd' | 'titulares'.
    pub async fn marcar_comunicacao_incidente(
        &self,
        ator: &Ator,
        id: i64,
        destino: &str,
    ) -> AppResult<()> {
        ator.exigir_admin()?;
        self.repo.marcar_comunicacao_incidente(id, destino).await?;
        self.logs
            .inserir(NovoLog {
                idfuncionario: Some(ator.id),
                acao: "lgpd:incidente_comunicacao".into(),
                obs: format!(
                    "{} marcou a comunicação do incidente #{id} a '{destino}'.",
                    ator.nome
                ),
                tabela: "lgpd_incidente",
                idtabela: id,
                dados: Some(serde_json::json!({"destino": destino})),
            })
            .await?;
        Ok(())
    }
}
