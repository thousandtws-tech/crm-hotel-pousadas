//! Senders externos por trÃ¡s da port `Emissor` (domain):
//!   `ResendEmissor`   â€” e-mail transacional (api.resend.com);
//!   `MetaWaEmissor`   â€” WhatsApp Cloud API (graph.facebook.com) â€” ativa com
//!                       `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_ID`; sem eles o
//!                       envio falha controlado e o worker aplica backoff;
//!   `VapidPushEmissor`â€” push PWA "tickle": POST VAPID-assinado sem payload;
//!                       o service worker busca o conteÃºdo na API.
//!
//! Nenhum payload do provedor vaza para o cliente â€” erros viram texto
//! curto em `ultimo_erro` (mesmo contrato do adaptador Stripe).

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

// ---------------------------------------------------------------------------
// e-mail â€” Resend
// ---------------------------------------------------------------------------

pub struct ResendEmissor {
    http: Client,
    api_key: String,
    /// Remetente verificado â€” ex.: "Pousada Espírito do Mar <reservas@espiritodomar.com.br>"
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

    async fn enviar(
        &self,
        destino: &str,
        _template: &str,
        payload: &serde_json::Value,
    ) -> Result<Option<String>, DomainError> {
        // Templates e-mail sÃ£o HTML gerado na aplicaÃ§Ã£o; o sender sÃ³ despacha.
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

// ---------------------------------------------------------------------------
// WhatsApp â€” Meta Cloud API (templates oficiais + texto livre na janela 24h)
// ---------------------------------------------------------------------------

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

    async fn enviar(
        &self,
        destino: &str,
        template: &str,
        payload: &serde_json::Value,
    ) -> Result<Option<String>, DomainError> {
        // `payload.tipo = "template"` â†’ envia template aprovado (fora da
        // janela 24h); `"texto"` â†’ texto livre (sÃ³ chega dentro da janela).
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

// ---------------------------------------------------------------------------
// WhatsApp — gateway WA-AKG (self-hosted, Baileys). Sem janela de 24h nem
// templates: tudo sai como texto livre; payload["texto"] é o conteúdo.
// ---------------------------------------------------------------------------

pub struct WaAkgEmissor {
    http: Client,
    /// Base do gateway — ex.: https://wa-akg.exemplo.net
    url: String,
    api_key: String,
    /// uuid da sessão conectada (path /api/messages/{sessionId}/…).
    session: String,
}

impl WaAkgEmissor {
    pub fn new(url: &str, api_key: String, session: String) -> Self {
        Self {
            http: http(),
            url: url.trim_end_matches('/').into(),
            api_key,
            session,
        }
    }
}

#[async_trait]
impl Emissor for WaAkgEmissor {
    fn canal(&self) -> CanalEnvio {
        CanalEnvio::Whatsapp
    }

    async fn enviar(
        &self,
        destino: &str,
        _template: &str,
        payload: &serde_json::Value,
    ) -> Result<Option<String>, DomainError> {
        let digitos: String = destino.chars().filter(char::is_ascii_digit).collect();
        if digitos.len() < 8 {
            return Err(DomainError::validacao("telefone inválido"));
        }
        let url = format!(
            "{}/api/messages/{}/{}@s.whatsapp.net/send",
            self.url, self.session, digitos
        );
        let corpo = serde_json::json!({
            "message": {"text": payload["texto"].as_str().unwrap_or("")}
        });
        let r = self
            .http
            .post(&url)
            .header("x-api-key", &self.api_key)
            .json(&corpo)
            .send()
            .await
            .map_err(|e| erro_http("waakg.send", &e))?;
        if !r.status().is_success() {
            return Err(erro_status("waakg.send", r).await);
        }
        let resp: serde_json::Value = r.json().await.map_err(|e| erro_http("waakg.parse", &e))?;
        Ok(resp["data"]["key"]["id"]
            .as_str()
            .or_else(|| resp["data"]["id"].as_str())
            .map(str::to_string))
    }
}

// ---------------------------------------------------------------------------
// push â€” VAPID tickle (JWT ES256, sem payload criptografado)
// ---------------------------------------------------------------------------

/// Chave VAPID do servidor (par P-256). Gere uma vez:
/// `openssl ecparam -name prime256v1 -genkey -noout -out vapid.pem`
/// pÃºblica = ponto nÃ£o-comprimido 65B em base64url (vai pro frontend).
pub struct VapidPushEmissor {
    http: Client,
    chave_privada_pem: String,
    /// base64url do ponto pÃºblico â€” exposta ao PWA em /push/vapid-key.
    pub publica_b64: String,
    /// `sub` do JWT â€” contato do operador (mailto:).
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

    async fn enviar(
        &self,
        destino: &str,
        _template: &str,
        _payload: &serde_json::Value,
    ) -> Result<Option<String>, DomainError> {
        // VAPID: JWT ES256 com aud = origin do endpoint, exp â‰¤ 24h, sub = contato.
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
        // Tickle: sem corpo â€” o SW recebe `push` e busca o conteÃºdo na API.
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
        // 201 = aceito; 404/410 = subscription morta â†’ a aplicaÃ§Ã£o remove.
        if r.status() == reqwest::StatusCode::GONE || r.status() == reqwest::StatusCode::NOT_FOUND {
            return Err(DomainError::regra("subscription expirada"));
        }
        if !r.status().is_success() {
            return Err(erro_status("push.send", r).await);
        }
        Ok(None)
    }
}

// ---------------------------------------------------------------------------
// helpers de validaÃ§Ã£o/encoding (compartilhados nos testes)
// ---------------------------------------------------------------------------

/// Hash opaco do endpoint push gravado como `destino` na fila â€” a URL
/// completa sÃ³ vive na `push_subscription` (endpoint contÃ©m token secreto).
pub fn endpoint_hash(endpoint: &str) -> String {
    use sha2::{Digest, Sha256};
    URL_SAFE_NO_PAD.encode(Sha256::digest(endpoint.as_bytes()))
}
