use std::time::Duration;

use async_trait::async_trait;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use clarituz_domain::enums::CanalEnvio;
use clarituz_domain::error::DomainError;
use clarituz_domain::ports::Emissor;
use reqwest::Client;

fn http() -> Client {
    Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .unwrap_or_default()
}

fn erro_http(ctx: &str, e: &reqwest::Error) -> DomainError {
    tracing::warn!(contexto = ctx, erro = %e, "sender: falha de rede");
    DomainError::Infra
}

async fn erro_status(ctx: &str, r: reqwest::Response) -> DomainError {
    let status = r.status();
    let corpo: serde_json::Value = r.json().await.unwrap_or_default();
    tracing::warn!(contexto = ctx, %status, corpo = %corpo, "sender: resposta de erro");
    DomainError::regra("Operação recusada pelo provedor.")
}

pub struct ResendEmissor {
    http: Client,
    api_key: String,
    remetente: String,
}

impl ResendEmissor {
    pub fn new(api_key: String, remetente: String) -> Self {
        Self {
            http: http(),
            api_key,
            remetente,
        }
    }
}

#[async_trait]
impl Emissor for ResendEmissor {
    fn canal(&self) -> CanalEnvio {
        CanalEnvio::Email
    }

    fn provedor(&self) -> &'static str {
        "resend"
    }

    async fn enviar(
        &self,
        destino: &str,
        _template: &str,
        payload: &serde_json::Value,
    ) -> Result<Option<String>, DomainError> {
        let corpo = serde_json::json!({
            "from": self.remetente,
            "to": [destino],
            "subject": payload["assunto"].as_str().unwrap_or("Pousada Espírito do Mar"),
            "html": payload["html"].as_str().unwrap_or(""),
        });
        let r = self
            .http
            .post("https://api.resend.com/emails")
            .bearer_auth(&self.api_key)
            .json(&corpo)
            .send()
            .await
            .map_err(|e| erro_http("resend.send", &e))?;
        if !r.status().is_success() {
            return Err(erro_status("resend.send", r).await);
        }
        let resp: serde_json::Value = r.json().await.map_err(|e| erro_http("resend.parse", &e))?;
        Ok(resp["id"].as_str().map(str::to_string))
    }
}

pub struct MetaWaEmissor {
    http: Client,
    token: String,
    phone_id: String,
}

impl MetaWaEmissor {
    pub fn new(token: String, phone_id: String) -> Self {
        Self {
            http: http(),
            token,
            phone_id,
        }
    }
}

#[async_trait]
impl Emissor for MetaWaEmissor {
    fn canal(&self) -> CanalEnvio {
        CanalEnvio::Whatsapp
    }

    fn provedor(&self) -> &'static str {
        "meta"
    }

    async fn enviar(
        &self,
        destino: &str,
        template: &str,
        payload: &serde_json::Value,
    ) -> Result<Option<String>, DomainError> {
        let url = format!(
            "https://graph.facebook.com/v21.0/{}/messages",
            self.phone_id
        );
        let corpo = if payload["tipo"].as_str() == Some("template") {
            serde_json::json!({
                "messaging_product": "whatsapp",
                "to": destino,
                "type": "template",
                "template": {
                    "name": template,
                    "language": {"code": "pt_BR"},
                    "components": payload["components"].clone(),
                }
            })
        } else {
            serde_json::json!({
                "messaging_product": "whatsapp",
                "to": destino,
                "type": "text",
                "text": {"body": payload["texto"].as_str().unwrap_or(""), "preview_url": true}
            })
        };
        let r = self
            .http
            .post(&url)
            .bearer_auth(&self.token)
            .json(&corpo)
            .send()
            .await
            .map_err(|e| erro_http("wa.send", &e))?;
        if !r.status().is_success() {
            return Err(erro_status("wa.send", r).await);
        }
        let resp: serde_json::Value = r.json().await.map_err(|e| erro_http("wa.parse", &e))?;
        Ok(resp["messages"][0]["id"].as_str().map(str::to_string))
    }
}

pub struct VapidPushEmissor {
    http: Client,
    chave_privada_pem: String,
    pub publica_b64: String,
    contato: String,
}

impl VapidPushEmissor {
    pub fn new(chave_privada_pem: String, publica_b64: String, contato: String) -> Self {
        Self {
            http: http(),
            chave_privada_pem,
            publica_b64,
            contato,
        }
    }
}

#[async_trait]
impl Emissor for VapidPushEmissor {
    fn canal(&self) -> CanalEnvio {
        CanalEnvio::Push
    }

    fn provedor(&self) -> &'static str {
        "push"
    }

    async fn enviar(
        &self,
        destino: &str,
        _template: &str,
        _payload: &serde_json::Value,
    ) -> Result<Option<String>, DomainError> {
        let url = url::Url::parse(destino)
            .map_err(|_| DomainError::validacao("endpoint push invÃ¡lido"))?;
        let aud = format!("{}://{}", url.scheme(), url.host_str().unwrap_or_default());
        let exp = (chrono::Utc::now() + chrono::Duration::hours(12)).timestamp() as usize;
        let claims = serde_json::json!({"aud": aud, "exp": exp, "sub": self.contato});
        let key = jsonwebtoken::EncodingKey::from_ec_pem(self.chave_privada_pem.as_bytes())
            .map_err(|e| {
                tracing::error!(erro = %e, "vapid: chave PEM invÃ¡lida");
                DomainError::Infra
            })?;
        let mut header = jsonwebtoken::Header::new(jsonwebtoken::Algorithm::ES256);
        header.typ = Some("JWT".into());
        let jwt = jsonwebtoken::encode(&header, &claims, &key).map_err(|_| DomainError::Infra)?;
        let r = self
            .http
            .post(destino)
            .header(
                "Authorization",
                format!("vapid t={jwt}, k={}", self.publica_b64),
            )
            .header("TTL", "60")
            .send()
            .await
            .map_err(|e| erro_http("push.send", &e))?;
        if r.status() == reqwest::StatusCode::GONE || r.status() == reqwest::StatusCode::NOT_FOUND {
            return Err(DomainError::regra("subscription expirada"));
        }
        if !r.status().is_success() {
            return Err(erro_status("push.send", r).await);
        }
        Ok(None)
    }
}

pub fn endpoint_hash(endpoint: &str) -> String {
    use sha2::{Digest, Sha256};
    URL_SAFE_NO_PAD.encode(Sha256::digest(endpoint.as_bytes()))
}
