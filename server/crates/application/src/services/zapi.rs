//! Webhook Z-API — autenticidade (bearer na URL + instanceId), inbox
//! durável antes do ACK e roteamento dos eventos pros serviços de
//! domínio. Dedup por (provedor, event_id) acontece **antes** de
//! qualquer efeito (pré-reserva, opt-out, IA, marcas de entrega).

use std::sync::Arc;

use clarituz_domain::error::DomainError;
use clarituz_domain::ports::{
    ComunicacaoEventoRepository, ComunicacaoResolver, FilaEnvioRepository, IntegracaoRepository,
};

use crate::error::AppResult;
use crate::services::concierge::ConciergeService;

pub struct ZApiService {
    com: Arc<dyn ComunicacaoResolver>,
    eventos: Arc<dyn ComunicacaoEventoRepository>,
    fila: Arc<dyn FilaEnvioRepository>,
    concierge: Arc<ConciergeService>,
    integracoes: Arc<dyn IntegracaoRepository>,
}

impl ZApiService {
    pub fn new(
        com: Arc<dyn ComunicacaoResolver>,
        eventos: Arc<dyn ComunicacaoEventoRepository>,
        fila: Arc<dyn FilaEnvioRepository>,
        concierge: Arc<ConciergeService>,
        integracoes: Arc<dyn IntegracaoRepository>,
    ) -> Self {
        Self {
            com,
            eventos,
            fila,
            concierge,
            integracoes,
        }
    }

    /// Comparação em tempo constante — o segredo é bearer, não pode
    /// vazar via timing.
    fn ct_eq(a: &str, b: &str) -> bool {
        let (a, b) = (a.as_bytes(), b.as_bytes());
        a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
    }

    /// Autentica o callback: segredo no path (CT) + `instanceId` do
    /// payload deve ser o da instância configurada.
    pub async fn autenticar(&self, segredo: &str, instance_id: &str) -> AppResult<Option<i64>> {
        let Some(esperado) = self.com.segredo_zapi("webhook_segredo").await? else {
            return Ok(None);
        };
        if !Self::ct_eq(segredo, &esperado) {
            return Ok(None);
        }
        let Some(integ) = self.com.integracao_zapi().await? else {
            return Ok(None);
        };
        let configurado = integ.config["instance_id"].as_str().unwrap_or_default();
        if configurado.is_empty() || configurado != instance_id {
            return Ok(None);
        }
        Ok(Some(integ.id))
    }

    /// Inbox + processamento — chamado pelo route após `autenticar`.
    /// Devolve `false` quando o evento é duplicado (dedup antes dos efeitos).
    pub async fn receber(&self, payload: &serde_json::Value, idintegracao: i64) -> AppResult<bool> {
        let (tipo, event_id) = Self::identidade(payload);
        let Some(id) = self
            .eventos
            .inbox("zapi", &event_id, &tipo, payload, Some(idintegracao))
            .await?
        else {
            return Ok(false); // reentrega do provedor — nada a fazer
        };
        match self.processar(payload, &tipo).await {
            Ok(descartar) => {
                if descartar {
                    self.eventos.descartar(id).await?;
                } else {
                    self.eventos.marcar_processado(id).await?;
                }
            }
            Err(e) => {
                self.eventos.marcar_falha(id, &e.to_string()).await?;
                return Err(e);
            }
        }
        Ok(true)
    }

    /// Reprocessa o que ficou pendente — sweeper chamado pelo worker.
    pub async fn reprocessar(&self) -> AppResult<u32> {
        let pendentes = self.eventos.pendentes(50).await?;
        let mut n = 0u32;
        for ev in pendentes {
            match self.processar(&ev.payload, &ev.tipo).await {
                Ok(descartar) => {
                    if descartar {
                        self.eventos.descartar(ev.id).await?;
                    } else {
                        self.eventos.marcar_processado(ev.id).await?;
                    }
                    n += 1;
                }
                Err(e) => {
                    self.eventos.marcar_falha(ev.id, &e.to_string()).await?;
                }
            }
        }
        Ok(n)
    }

    /// (tipo, event_id) — o id compõe tipo+referência pra que SENT→
    /// RECEIVED→READ da mesma mensagem gerem eventos distintos.
    fn identidade(p: &serde_json::Value) -> (String, String) {
        let tipo = p["type"].as_str().unwrap_or("desconhecido").to_string();
        let msg = p["messageId"]
            .as_str()
            .or_else(|| p["id"].as_str())
            .unwrap_or_default();
        let status = p["status"].as_str().unwrap_or_default();
        let momment = p["momment"].as_u64().unwrap_or_default();
        let id = if msg.is_empty() {
            format!(
                "{tipo}:{}:{momment}",
                p["instanceId"].as_str().unwrap_or("?")
            )
        } else {
            format!("{tipo}:{msg}:{status}")
        };
        (tipo, id)
    }

    /// Despacha o evento normalizado — `Ok(true)` descarta sem efeito.
    async fn processar(&self, p: &serde_json::Value, tipo: &str) -> AppResult<bool> {
        match tipo {
            "ReceivedCallback" => self.processar_recebido(p).await,
            "DeliveryCallback" => {
                let mut n = false;
                if let Some(id) = p["messageId"].as_str() {
                    n = self.fila.marcar_entrega("zapi", id).await? > 0 || n;
                }
                Ok(!n) // sem item casado → descarta silencioso
            }
            "MessageStatusCallback" => {
                let mut algum = false;
                if let Some(ids) = p["ids"].as_array() {
                    for id in ids.iter().filter_map(|i| i.as_str()) {
                        let n = match p["status"].as_str() {
                            // SENT/RECEIVED avançam o marco de entrega.
                            Some("SENT" | "RECEIVED" | "PENDING") => {
                                self.fila.marcar_entrega("zapi", id).await?
                            }
                            Some("READ") => self.fila.marcar_lido("zapi", id).await?,
                            // READ_BY_ME = nós lemos a do hóspede — sem efeito
                            // em saída; PLAYED exige mídia — fora do escopo.
                            _ => 0,
                        };
                        algum = algum || n > 0;
                    }
                }
                Ok(!algum)
            }
            "ConnectedCallback" => {
                self.sessao(true, p["phone"].as_str().map(str::to_string))
                    .await
            }
            "DisconnectedCallback" => self.sessao(false, None).await,
            _ => Ok(true), // tipo desconhecido — sem efeito, sem retry
        }
    }

    /// Mensagem recebida — filtros do contrato antes dos efeitos:
    /// `fromMe`, `waitingMessage`, grupos/broadcast não disparam bot.
    async fn processar_recebido(&self, p: &serde_json::Value) -> AppResult<bool> {
        if p["fromMe"].as_bool().unwrap_or(false)
            || p["waitingMessage"].as_bool().unwrap_or(false)
            || p["isGroup"].as_bool().unwrap_or(false)
            || p["isNewsletter"].as_bool().unwrap_or(false)
        {
            return Ok(true);
        }
        let de = p["phone"].as_str().unwrap_or_default();
        if de.is_empty() || de.contains('@') {
            return Ok(true); // @lid/@g.us não são telefone
        }
        // Texto — mídia/outros tipos registram o tipo sem fingir entendimento.
        let texto = p["text"]["message"].as_str().map_or_else(
            || format!("[{}]", p["type"].as_str().unwrap_or("midia")),
            str::to_string,
        );
        let msgid = p["messageId"].as_str().filter(|s| !s.is_empty());
        self.concierge.whatsapp_inbound(de, msgid, &texto).await?;
        Ok(false)
    }

    async fn sessao(&self, conectado: bool, telefone: Option<String>) -> AppResult<bool> {
        let Some(integ) = self.com.integracao_zapi().await? else {
            return Ok(true);
        };
        let mut patch = serde_json::json!({"sessao": {"conectado": conectado}});
        if let Some(t) = telefone {
            patch["sessao"]["telefone"] = t.into();
        }
        if !conectado {
            // Desconexão deixa rastro explícito pra alerta operacional.
            patch["sessao"]["desconectado_em"] = chrono::Utc::now().to_rfc3339().into();
            tracing::warn!("zapi: sessão desconectada — reconectar no painel de integrações");
        }
        self.integracoes.mesclar_config(integ.id, &patch).await?;
        Ok(false)
    }

    /// Erros do processamento não vazam — DomainError já sanitiza.
    pub fn erro_para_status(e: &DomainError) -> &'static str {
        match e {
            DomainError::NaoEncontrado(_) => "not_found",
            _ => "internal",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::ZApiService;
    use serde_json::json;

    #[test]
    fn identidade_separa_estados_da_mesma_mensagem() {
        let base = json!({"instanceId": "i1", "messageId": "m1", "momment": 1});
        let mut sent = base.clone();
        sent["type"] = "MessageStatusCallback".into();
        sent["status"] = "SENT".into();
        let mut read = base;
        read["type"] = "MessageStatusCallback".into();
        read["status"] = "READ".into();
        let (_, a) = ZApiService::identidade(&sent);
        let (_, b) = ZApiService::identidade(&read);
        assert_ne!(a, b); // SENT e READ da mesma msg = eventos distintos
    }

    #[test]
    fn identidade_recebido_por_messageid() {
        let p = json!({"type": "ReceivedCallback", "messageId": "m9", "instanceId": "i1"});
        let (t, id) = ZApiService::identidade(&p);
        assert_eq!(t, "ReceivedCallback");
        assert!(id.contains("m9"));
    }

    #[test]
    fn ct_eq_compara_em_tempo_constante() {
        assert!(ZApiService::ct_eq("abc", "abc"));
        assert!(!ZApiService::ct_eq("abc", "abd"));
        assert!(!ZApiService::ct_eq("abc", "abcd"));
    }
}
