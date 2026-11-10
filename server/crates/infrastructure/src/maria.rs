//! Adaptador HTTP do serviço Inná (FastAPI) — a porta `ConciergeIa` do
//! domain. A aplicação monta o contexto seguro da reserva; este cliente só
//! transporta a chamada. Autenticado por chave interna compartilhada
//! (`X-Internal-Key`), nunca pelo token do hóspede.

use std::time::Duration;

use async_trait::async_trait;
use clarituz_domain::error::DomainError;
use clarituz_domain::ports::{ConciergeIa, ConciergeResposta, InnaMensagem};
use reqwest::Client;

pub struct MariaClient {
    http: Client,
    /// Base do serviço — ex.: `https://maria-production.up.railway.app`.
    url: String,
    /// Segredo compartilhado api↔maria (env `INNA_INTERNAL_KEY` nos dois).
    key: String,
}

impl MariaClient {
    pub fn new(url: &str, key: String) -> Self {
        Self {
            http: Client::builder()
                .timeout(Duration::from_secs(30))
                .build()
                .unwrap_or_default(),
            url: format!("{}/ia/concierge", url.trim_end_matches('/')),
            key,
        }
    }
}

#[async_trait]
impl ConciergeIa for MariaClient {
    async fn responder(
        &self,
        contexto: &serde_json::Value,
        mensagem: &str,
        historico: &[InnaMensagem],
    ) -> Result<ConciergeResposta, DomainError> {
        let corpo = serde_json::json!({
            "mensagem": mensagem,
            "contexto": contexto,
            "historico": historico
                .iter()
                .map(|m| serde_json::json!({"origem": m.origem, "texto": m.texto}))
                .collect::<Vec<_>>(),
        });
        let r = self
            .http
            .post(&self.url)
            .header("x-internal-key", &self.key)
            .json(&corpo)
            .send()
            .await
            .map_err(|e| {
                tracing::warn!(erro = %e, "maria: falha de rede");
                DomainError::Infra
            })?;
        if !r.status().is_success() {
            let status = r.status();
            tracing::warn!(%status, "maria: resposta de erro");
            return Err(DomainError::Infra);
        }
        let resp: serde_json::Value = r.json().await.map_err(|e| {
            tracing::warn!(erro = %e, "maria: resposta inválida");
            DomainError::Infra
        })?;
        let texto = resp["resposta"].as_str().unwrap_or_default().to_string();
        if texto.is_empty() {
            return Err(DomainError::Infra);
        }
        Ok(ConciergeResposta {
            texto,
            escalar: resp["escalar"].as_bool().unwrap_or(false),
            motivo: resp["motivo"].as_str().map(str::to_string),
        })
    }
}
