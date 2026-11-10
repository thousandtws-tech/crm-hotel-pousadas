//! LGPD 13.709/18 — consentimento, opt-out, direitos do titular (art. 18),
//! aceite de termos (CDC) e retenção com anonimização (art. 16).
//!
//! Templates não-transacionais (pesquisa, campanhas) respeitam opt-out;
//! transacionais (FNRH, cobrança, operação da estadia) seguem sempre —
//! base legal = execução de contrato.

use std::sync::Arc;

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
}

impl LgpdService {
    pub fn new(repo: Arc<dyn LgpdRepository>, eventos: Arc<dyn EventoPublisher>) -> Self {
        Self { repo, eventos }
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
    pub async fn exportar_cliente(&self, idcliente: i64) -> AppResult<serde_json::Value> {
        Ok(self.repo.exportar_cliente(idcliente).await?)
    }

    /// Eliminação — anonimiza preservando trilha legal (art. 16).
    /// Executada via solicitação do titular ou pela retenção.
    pub async fn anonimizar_cliente(&self, ator: &Ator, idcliente: i64) -> AppResult<()> {
        self.repo.anonimizar_cliente(idcliente).await?;
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
}
