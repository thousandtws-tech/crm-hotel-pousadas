//! Webhook Infobip — delivery reports (DLR) do canal SMS.
//!
//! Autenticidade: segredo no path (CT), gerado na 1ª gravação da
//! integração e configurado como `webhooks.delivery.url` em cada envio.
//! Dedup por (provedor, event_id) na inbox durável **antes** de
//! qualquer efeito — reentrega do provedor é no-op.
//!
//! Mapeamento `status.groupName` → marco na fila:
//! - `DELIVERED`                       → `entregue_em` (marco terminal de sucesso)
//! - `REJECTED` / `UNDELIVERABLE` /
//!   `EXPIRED`                         → 'falhou' via `marcar_falha_remota`
//! - `PENDING` / `ACCEPTED` / demais   → trânsito — sem efeito, sem retry
//!
//! Um DLR tardio também resolve item `desconhecido` (resposta que o
//! worker não viu) — a query de falha remota cobre esse estado.

use std::sync::Arc;

use clarituz_domain::error::DomainError;
use clarituz_domain::ports::{
    ComunicacaoEventoRepository, ComunicacaoResolver, FilaEnvioRepository,
};

use crate::error::AppResult;

pub struct InfobipService {
    com: Arc<dyn ComunicacaoResolver>,
    eventos: Arc<dyn ComunicacaoEventoRepository>,
    fila: Arc<dyn FilaEnvioRepository>,
}

impl InfobipService {
    pub fn new(
        com: Arc<dyn ComunicacaoResolver>,
        eventos: Arc<dyn ComunicacaoEventoRepository>,
        fila: Arc<dyn FilaEnvioRepository>,
    ) -> Self {
        Self { com, eventos, fila }
    }

    /// Comparação em tempo constante — o segredo é bearer, não pode
    /// vazar via timing.
    fn ct_eq(a: &str, b: &str) -> bool {
        let (a, b) = (a.as_bytes(), b.as_bytes());
        a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
    }

    /// Autentica o callback: segredo no path (CT) contra o
    /// `webhook_secret` do cofre. Devolve a integração quando válida.
    pub async fn autenticar(&self, segredo: &str) -> AppResult<Option<i64>> {
        let Some(esperado) = self.com.segredo_infobip("webhook_secret").await? else {
            return Ok(None);
        };
        if !Self::ct_eq(segredo, &esperado) {
            return Ok(None);
        }
        let Some(integ) = self.com.integracao_infobip().await? else {
            return Ok(None);
        };
        Ok(Some(integ.id))
    }

    /// Inbox + processamento — chamado pelo route após `autenticar`.
    /// O payload pode trazer vários `results[]`; cada resultado é um
    /// evento próprio na inbox (dedup por messageId+status).
    pub async fn receber(&self, payload: &serde_json::Value, idintegracao: i64) -> AppResult<()> {
        let resultados: Vec<serde_json::Value> = payload["results"]
            .as_array()
            .cloned()
            .unwrap_or_else(|| vec![payload.clone()]);
        for resultado in &resultados {
            self.receber_resultado(resultado, idintegracao).await?;
        }
        Ok(())
    }

    /// Reprocessa o que ficou pendente — sweeper chamado pelo worker.
    pub async fn reprocessar(&self) -> AppResult<u32> {
        let pendentes = self.eventos.pendentes(50).await?;
        let mut n = 0u32;
        for ev in pendentes {
            if ev.provedor != "infobip" {
                continue;
            }
            match self.processar(&ev.payload).await {
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

    async fn receber_resultado(
        &self,
        resultado: &serde_json::Value,
        idintegracao: i64,
    ) -> AppResult<()> {
        let event_id = Self::identidade(resultado);
        let Some(id) = self
            .eventos
            .inbox("infobip", &event_id, "dlr", resultado, Some(idintegracao))
            .await?
        else {
            return Ok(()); // reentrega do provedor — nada a fazer
        };
        match self.processar(resultado).await {
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
        Ok(())
    }

    /// `dlr:{messageId}:{status}` — estados distintos da mesma mensagem
    /// (PENDING→DELIVERED) geram eventos distintos; repetição do mesmo
    /// estado é deduplicada.
    fn identidade(r: &serde_json::Value) -> String {
        let msg = r["messageId"].as_str().unwrap_or("?");
        let grupo = r["status"]["groupName"].as_str().unwrap_or("?");
        let nome = r["status"]["name"].as_str().unwrap_or("?");
        format!("dlr:{msg}:{grupo}:{nome}")
    }

    /// Aplica o marco do DLR — `Ok(true)` descarta sem efeito (DLR sem
    /// item casado ou estado de trânsito).
    async fn processar(&self, r: &serde_json::Value) -> AppResult<bool> {
        let Some(msg_id) = r["messageId"].as_str().filter(|s| !s.is_empty()) else {
            return Ok(true);
        };
        let grupo = r["status"]["groupName"].as_str().unwrap_or_default();
        match grupo {
            "DELIVERED" => Ok(self.fila.marcar_entrega("infobip", msg_id).await? == 0),
            "REJECTED" | "UNDELIVERABLE" | "EXPIRED" => {
                let detalhe = r["status"]["description"]
                    .as_str()
                    .or_else(|| r["status"]["name"].as_str())
                    .or_else(|| r["error"]["description"].as_str())
                    .unwrap_or(grupo);
                let erro = format!("infobip: {grupo} — {detalhe}");
                Ok(self
                    .fila
                    .marcar_falha_remota("infobip", msg_id, &erro)
                    .await?
                    == 0)
            }
            // PENDING/ACCEPTED — trânsito: processado sem marco.
            _ => Ok(false),
        }
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
    use super::InfobipService;
    use serde_json::json;

    #[test]
    fn identidade_separa_estados_da_mesma_mensagem() {
        let pend = json!({"messageId": "m1", "status": {"groupName": "PENDING", "name": "PENDING_ENROUTE"}});
        let ent = json!({"messageId": "m1", "status": {"groupName": "DELIVERED", "name": "DELIVERED_TO_HANDSET"}});
        let pend2 = pend.clone();
        assert_ne!(
            InfobipService::identidade(&pend),
            InfobipService::identidade(&ent)
        );
        assert_eq!(
            InfobipService::identidade(&pend),
            InfobipService::identidade(&pend2)
        );
    }

    #[test]
    fn ct_eq_compara_em_tempo_constante() {
        assert!(InfobipService::ct_eq("abc", "abc"));
        assert!(!InfobipService::ct_eq("abc", "abd"));
        assert!(!InfobipService::ct_eq("abc", "abcd"));
    }
}
