//! Cliente Didit — verificação de identidade (KYC) hospedada, API v3.
//!
//! - `POST /v3/session/` cria a sessão hospedada (retorna `url` p/ o usuário).
//! - `GET /v3/session/{id}/decision/` consulta a decisão a qualquer momento.
//! - `POST /v3/webhook/destinations/` registra destino e devolve
//!   `secret_shared_key` (HMAC-SHA256 nos headers `X-Signature`/`X-Timestamp`).

use async_trait::async_trait;
use chrono::Utc;
use clarituz_domain::error::DomainError;
use clarituz_domain::ports::{
    DecisaoRemota, DestinoWebhook, ProvedorVerificacao, SessaoVerificacao,
};
use hmac::{Hmac, Mac};
use reqwest::{Client, StatusCode};
use serde::Deserialize;
use sha2::Sha256;
use std::time::Duration;
use subtle::ConstantTimeEq;
use tracing::{error, warn};

type HmacSha256 = Hmac<Sha256>;

const BASE: &str = "https://verification.didit.me";
const TOLERANCIA_ASSINATURA_S: i64 = 300;

pub struct DiditCliente {
    http: Client,
    api_key: String,
    base_url: String,
}

impl DiditCliente {
    pub fn new(api_key: String) -> Self {
        let http = Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .build()
            .unwrap_or_else(|_| Client::new());
        Self {
            http,
            api_key,
            base_url: BASE.into(),
        }
    }

    #[cfg(test)]
    pub fn para_teste(api_key: String, base_url: String) -> Self {
        let http = Client::new();
        Self {
            http,
            api_key,
            base_url,
        }
    }

    fn erro_http(contexto: &str, e: &reqwest::Error) -> DomainError {
        error!(contexto, erro = %e, "didit: falha de transporte");
        DomainError::Infra
    }

    fn erro_status(contexto: &str, status: StatusCode, corpo: &str) -> DomainError {
        warn!(contexto, status = %status, "didit: resposta de erro");
        let detalhe = serde_json::from_str::<serde_json::Value>(corpo)
            .ok()
            .and_then(|v| {
                v["message"]
                    .as_str()
                    .or_else(|| v["error"].as_str())
                    .or_else(|| v["detail"].as_str())
                    .map(|s| s.chars().take(180).collect::<String>())
            })
            .filter(|s| !s.is_empty());
        match status {
            StatusCode::TOO_MANY_REQUESTS => {
                DomainError::conflito("Didit ocupada — aguarde e tente novamente.")
            }
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
                DomainError::regra("Credencial recusada pela Didit — verifique a chave de API.")
            }
            s if s.is_client_error() => DomainError::regra(match detalhe {
                Some(d) => format!("Operação recusada pela Didit: {d}"),
                None => "Operação recusada pela Didit.".into(),
            }),
            _ => DomainError::Infra,
        }
    }

    async fn get(
        &self,
        contexto: &'static str,
        path: &str,
    ) -> Result<serde_json::Value, DomainError> {
        let resp = self
            .http
            .get(format!("{}{path}", self.base_url))
            .header("x-api-key", &self.api_key)
            .send()
            .await
            .map_err(|e| Self::erro_http(contexto, &e))?;
        let status = resp.status();
        let corpo = resp
            .text()
            .await
            .map_err(|e| Self::erro_http(contexto, &e))?;
        if !status.is_success() {
            return Err(Self::erro_status(contexto, status, &corpo));
        }
        serde_json::from_str(&corpo).map_err(|e| {
            error!(contexto, erro = %e, "didit: resposta malformada");
            DomainError::Infra
        })
    }

    async fn post(
        &self,
        contexto: &'static str,
        path: &str,
        body: &serde_json::Value,
    ) -> Result<serde_json::Value, DomainError> {
        let resp = self
            .http
            .post(format!("{}{path}", self.base_url))
            .header("x-api-key", &self.api_key)
            .header("Content-Type", "application/json")
            .json(body)
            .send()
            .await
            .map_err(|e| Self::erro_http(contexto, &e))?;
        let status = resp.status();
        let corpo = resp
            .text()
            .await
            .map_err(|e| Self::erro_http(contexto, &e))?;
        if !status.is_success() {
            return Err(Self::erro_status(contexto, status, &corpo));
        }
        serde_json::from_str(&corpo).map_err(|e| {
            error!(contexto, erro = %e, "didit: resposta malformada");
            DomainError::Infra
        })
    }
}

#[derive(Deserialize)]
struct SessaoResp {
    session_id: String,
    url: String,
}

#[async_trait]
impl ProvedorVerificacao for DiditCliente {
    /// `GET /v3/webhook/destinations/` — leitura autenticada sem efeito
    /// lateral; prova a chave e devolve o nº de destinos configurados.
    async fn testar(&self) -> Result<String, DomainError> {
        let v = self
            .get("destinations", "/v3/webhook/destinations/")
            .await?;
        let n = v
            .as_array()
            .map(|a| a.len())
            .or_else(|| v["destinations"].as_array().map(|a| a.len()))
            .or_else(|| v["items"].as_array().map(|a| a.len()))
            .unwrap_or(0);
        Ok(format!("didit-ok ({n} destinos de webhook)"))
    }

    async fn criar_sessao(
        &self,
        workflow_id: &str,
        vendor_data: &str,
        callback: Option<&str>,
    ) -> Result<SessaoVerificacao, DomainError> {
        let mut body = serde_json::json!({
            "workflow_id": workflow_id,
            "vendor_data": vendor_data,
        });
        if let Some(cb) = callback.filter(|c| !c.is_empty()) {
            body["callback"] = serde_json::Value::String(cb.to_string());
        }
        let v: SessaoResp =
            serde_json::from_value(self.post("session.create", "/v3/session/", &body).await?)
                .map_err(|e| {
                    error!(erro = %e, "didit: sessão malformada");
                    DomainError::Infra
                })?;
        Ok(SessaoVerificacao {
            session_id: v.session_id,
            url: v.url,
        })
    }

    async fn decisao(&self, session_id: &str) -> Result<DecisaoRemota, DomainError> {
        let v = self
            .get(
                "session.decision",
                &format!("/v3/session/{session_id}/decision/"),
            )
            .await?;
        let status = v["status"]
            .as_str()
            .ok_or_else(|| {
                error!("didit: decisão sem status");
                DomainError::Infra
            })?
            .to_string();
        Ok(DecisaoRemota { status, resumo: v })
    }

    async fn registrar_destino(&self, url: &str) -> Result<DestinoWebhook, DomainError> {
        let v = self
            .post(
                "webhook.register",
                "/v3/webhook/destinations/",
                &serde_json::json!({
                    "label": "CRM Pousada — verificacao_identidade",
                    "url": url,
                    "subscribed_events": ["status.updated", "data.updated"],
                    "webhook_version": "v3",
                }),
            )
            .await?;
        let segredo = v["secret_shared_key"]
            .as_str()
            .or_else(|| v["destination"]["secret_shared_key"].as_str())
            .ok_or_else(|| {
                error!(body = %v, "didit: destino sem secret_shared_key");
                DomainError::Infra
            })?
            .to_string();
        let id = v["destination_uuid"]
            .as_str()
            .or_else(|| v["id"].as_str())
            .or_else(|| v["destination"]["destination_uuid"].as_str())
            .unwrap_or_default()
            .to_string();
        Ok(DestinoWebhook {
            id,
            secret_shared_key: segredo,
        })
    }
}

/// Verifica `X-Signature` (HMAC-SHA256 do **corpo cru**, hex ou base64) e a
/// janela de `X-Timestamp` (±5 min). A Didit também envia `X-Signature-V2`
/// (JSON canônico) — verificamos o V1 sobre os bytes recebidos, que é o
/// formato documentado para stacks que não recodificam o corpo.
pub fn verificar_assinatura(
    segredo: &str,
    x_signature: &str,
    x_timestamp: &str,
    corpo: &[u8],
) -> Result<(), DomainError> {
    let ts: i64 = x_timestamp
        .trim()
        .parse()
        .map_err(|_| DomainError::nao_autenticado("Timestamp de webhook malformado."))?;
    if (Utc::now().timestamp() - ts).abs() > TOLERANCIA_ASSINATURA_S {
        return Err(DomainError::nao_autenticado(
            "Webhook fora da janela de tolerância.",
        ));
    }

    let mut mac = HmacSha256::new_from_slice(segredo.as_bytes()).map_err(|_| DomainError::Infra)?;
    mac.update(corpo);
    let esperado = mac.finalize().into_bytes();

    let assinatura = x_signature.trim();
    let recebido = hex::decode(assinatura)
        .ok()
        .or_else(|| {
            use base64::Engine;
            base64::engine::general_purpose::STANDARD
                .decode(assinatura)
                .ok()
        })
        .ok_or_else(|| DomainError::nao_autenticado("Assinatura de webhook malformada."))?;

    if recebido.len() != esperado.len() || recebido.ct_eq(&esperado).unwrap_u8() != 1 {
        return Err(DomainError::nao_autenticado(
            "Assinatura de webhook inválida.",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;

    fn assinatura_hex(segredo: &str, corpo: &[u8]) -> String {
        let mut mac = HmacSha256::new_from_slice(segredo.as_bytes()).unwrap();
        mac.update(corpo);
        hex::encode(mac.finalize().into_bytes())
    }

    #[test]
    fn assinatura_valida_hex() {
        let corpo = br#"{"a":1}"#;
        let sig = assinatura_hex("seg", corpo);
        let ts = Utc::now().timestamp().to_string();
        assert!(verificar_assinatura("seg", &sig, &ts, corpo).is_ok());
    }

    #[test]
    fn assinatura_valida_base64() {
        let corpo = b"payload";
        let mut mac = HmacSha256::new_from_slice(b"seg").unwrap();
        mac.update(corpo);
        let sig = base64::engine::general_purpose::STANDARD.encode(mac.finalize().into_bytes());
        let ts = Utc::now().timestamp().to_string();
        assert!(verificar_assinatura("seg", &sig, &ts, corpo).is_ok());
    }

    #[test]
    fn rejeita_segredo_errado_e_timestamp_velho() {
        let corpo = b"payload";
        let sig = assinatura_hex("seg", corpo);
        let ts = Utc::now().timestamp().to_string();
        assert!(verificar_assinatura("outro", &sig, &ts, corpo).is_err());
        let velho = (Utc::now().timestamp() - 600).to_string();
        assert!(verificar_assinatura("seg", &sig, &velho, corpo).is_err());
    }
}
