//! Adaptador Infobip — SMS apenas. `Authorization: App {API_KEY}`.
//!
//! - `POST {base}/sms/3/messages` — envio (1 mensagem/chamada; o payload
//!   carrega `webhooks.delivery` quando o callback está configurado).
//! - `GET {base}/sms/1/logs?limit=1` — teste de conexão por LEITURA,
//!   nunca um envio cobrável disfarçado.
//! - Base URL validada na fronteira: https + host oficial *.infobip.com,
//!   sem redirect (a API key não pode sair do host de origem).
//!
//! DLR: o callback chega em `/api/v1/webhooks/infobip/{segredo}` — a
//! autenticação é o segredo no path (notification profiles aceitam URL
//! arbitrária; camada extra de auth fica no perfil do provedor).

use std::sync::OnceLock;
use std::time::Duration;

use async_trait::async_trait;
use reqwest::Client;
use serde::Deserialize;

use clarituz_domain::enums::CanalEnvio;
use clarituz_domain::error::DomainError;
use clarituz_domain::ports::{CredenciaisInfobip, Emissor};

// Reexporta — a validação canônica mora no domínio (gravação da
// integração e montagem deste cliente passam pela mesma regra).
pub use clarituz_domain::value_objects::infobip_url::validar_base_url;

const TIMEOUT_S: u64 = 15;

#[derive(Clone)]
pub struct InfobipCredenciais {
    pub base_url: String,
    pub api_key: String,
    pub remetente: String,
    pub limite_segmentos: i32,
    pub callback_url: Option<String>,
}

fn http() -> Client {
    static CLI: OnceLock<Client> = OnceLock::new();
    CLI.get_or_init(|| {
        Client::builder()
            .timeout(Duration::from_secs(TIMEOUT_S))
            // API key não atravessa redirect — falha explícita, nunca vaza.
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap_or_else(|_| Client::new())
    })
    .clone()
}

fn erro_http(ctx: &str, e: &reqwest::Error) -> DomainError {
    let classe = if e.is_timeout() { "timeout" } else { "rede" };
    tracing::warn!(ctx, %e, classe, "infobip: falha de transporte");
    DomainError::Infra
}

fn erro_status(ctx: &str, status: reqwest::StatusCode, retry_after: Option<u64>) -> DomainError {
    let detalhe = match status.as_u16() {
        401 | 403 => "credencial inválida ou sem permissão de SMS",
        400 => "requisição recusada (remetente/destino/payload)",
        429 => "limite de taxa do provedor",
        s if (500..=599).contains(&s) => "falha transitória do provedor",
        _ => "resposta inesperada do provedor",
    };
    // Detalhe + Retry-After vão pro log estruturado — o item volta
    // pra fila pelo backoff exponencial do worker (≥ Retry-After de
    // ~1min na maioria dos limites).
    tracing::warn!(ctx, %status, detalhe, ?retry_after, "infobip: resposta de erro");
    DomainError::Infra
}

#[derive(Debug, Deserialize)]
struct LogResp {
    results: Option<Vec<serde_json::Value>>,
}

#[derive(Debug, Deserialize)]
struct SendResp {
    #[serde(rename = "bulkId")]
    bulk_id: Option<String>,
    messages: Option<Vec<SendMsg>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendMsg {
    message_id: Option<String>,
    status: Option<StatusInfo>,
    #[serde(rename = "messageCount")]
    message_count: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StatusInfo {
    group_name: Option<String>,
    name: Option<String>,
    description: Option<String>,
}

#[derive(Debug)]
pub struct EnvioSms {
    pub message_id: Option<String>,
    pub bulk_id: Option<String>,
    /// Partes efetivas retornadas pelo provedor (messageCount).
    pub segmentos: Option<i32>,
}

pub struct InfobipCliente {
    cred: InfobipCredenciais,
}

impl InfobipCliente {
    pub fn new(cred: InfobipCredenciais) -> Self {
        Self { cred }
    }

    fn url(&self, sufixo: &str) -> String {
        format!("{}{sufixo}", self.cred.base_url)
    }

    /// Teste de conexão por leitura — `GET /sms/1/logs?limit=1`.
    /// Credencial válida+permissão SMS ⇒ 200 com `results[]`; nunca
    /// envia nada. Falha de parse = resposta fora do contrato.
    pub async fn testar(&self) -> Result<(), DomainError> {
        let r = http()
            .get(self.url("/sms/1/logs?limit=1"))
            .header("Authorization", format!("App {}", self.cred.api_key))
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(|e| erro_http("logs", &e))?;
        if !r.status().is_success() {
            let ra = retry_after(&r);
            return Err(erro_status("logs", r.status(), ra));
        }
        let resp = r
            .json::<LogResp>()
            .await
            .map_err(|e| erro_http("logs/parse", &e))?;
        tracing::debug!(encontrados = ?resp.results.map(|v| v.len()), "infobip: logs ok");
        Ok(())
    }

    /// Envio único — `POST /sms/3/messages`. `texto` já renderizado;
    /// o limite de segmentos é checado ANTES pelo emissor.
    pub async fn enviar(&self, destino: &str, texto: &str) -> Result<EnvioSms, DomainError> {
        let mut msg = serde_json::json!({
            "sender": self.cred.remetente,
            "destinations": [{"to": destino}],
            "content": {"text": texto},
        });
        if let Some(cb) = &self.cred.callback_url {
            msg["webhooks"] = serde_json::json!({"delivery": {"url": cb}});
        }
        let r = http()
            .post(self.url("/sms/3/messages"))
            .header("Authorization", format!("App {}", self.cred.api_key))
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .json(&serde_json::json!({"messages": [msg]}))
            .send()
            .await
            .map_err(|e| erro_http("envio", &e))?;
        if !r.status().is_success() {
            let ra = retry_after(&r);
            return Err(erro_status("envio", r.status(), ra));
        }
        let resp: SendResp = r.json().await.map_err(|e| erro_http("envio/parse", &e))?;
        let m = resp.messages.and_then(|v| v.into_iter().next());
        let (message_id, segmentos) = match &m {
            Some(m) => (m.message_id.clone(), m.message_count),
            None => (None, None),
        };
        // Provedor rejeitou na resposta (status de erro por destino).
        if let Some(st) = m.and_then(|m| m.status) {
            if let Some(g) = st.group_name.as_deref() {
                if matches!(g, "REJECTED" | "UNDELIVERABLE") {
                    return Err(DomainError::regra(format!(
                        "infobip rejeitou: {} — {}",
                        g,
                        st.description.or(st.name).unwrap_or_default()
                    )));
                }
            }
        }
        Ok(EnvioSms {
            message_id,
            bulk_id: resp.bulk_id,
            segmentos,
        })
    }
}

fn retry_after(r: &reqwest::Response) -> Option<u64> {
    r.headers()
        .get("retry-after")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
}

/// Emissor do canal SMS — resolve credenciais via `CredenciaisInfobip`
/// (config + cofre já abertos pelo resolver).
pub struct InfobipEmissor {
    cli: InfobipCliente,
}

impl InfobipEmissor {
    pub fn new(cred: &CredenciaisInfobip) -> Self {
        Self {
            cli: InfobipCliente::new(InfobipCredenciais {
                base_url: cred.base_url.clone(),
                api_key: cred.api_key.clone(),
                remetente: cred.remetente.clone(),
                limite_segmentos: cred.limite_segmentos,
                callback_url: cred.callback_url.clone(),
            }),
        }
    }
}

#[async_trait]
impl Emissor for InfobipEmissor {
    fn canal(&self) -> CanalEnvio {
        CanalEnvio::Sms
    }
    fn provedor(&self) -> &'static str {
        "infobip"
    }

    async fn enviar(
        &self,
        destino: &str,
        _template: &str,
        payload: &serde_json::Value,
    ) -> Result<Option<String>, DomainError> {
        use clarituz_domain::value_objects::{sms, telefone};
        let Some(to) = telefone::normalizar_whatsapp(destino) else {
            return Err(DomainError::validacao("telefone inválido para SMS"));
        };
        let texto = payload["texto"].as_str().unwrap_or("");
        if texto.is_empty() {
            return Err(DomainError::validacao("mensagem vazia"));
        }
        // Teto configurável — mensagem longa demais não sai (custo × partes).
        let est = sms::estimar(texto);
        let limite = self.cli.cred.limite_segmentos.max(1) as usize;
        if est.partes > limite {
            return Err(DomainError::regra(format!(
                "mensagem excede o limite de {limite} segmentos \
                 ({} partes, {})",
                est.partes,
                est.codificacao.as_str()
            )));
        }
        let envio = self.cli.enviar(&to, texto).await?;
        // provider_msg_id = messageId (chave de correlação do DLR);
        // bulkId e segmentos efetivos ficam no log estruturado.
        tracing::info!(
            bulk = ?envio.bulk_id,
            msg = ?envio.message_id,
            segmentos = ?envio.segmentos,
            "infobip: SMS aceito"
        );
        Ok(envio.message_id)
    }
}
