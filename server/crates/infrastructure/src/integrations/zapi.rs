//! Cliente HTTP Z-API (`api.z-api.io`) — chamadas administrativas
//! (status, QR, webhooks, desconexão) e `ZApiEmissor` para a fila.
//!
//! Segurança: o `instance_token` viaja **no path** da URL e o
//! `client_token` no header — nenhum dos dois pode aparecer em erro,
//! log ou trace. Todos os erros passam por helpers que devolvem só
//! contexto + status, sem URL nem corpo do provedor.

use async_trait::async_trait;
use reqwest::Client;

use clarituz_domain::enums::CanalEnvio;
use clarituz_domain::error::DomainError;
use clarituz_domain::ports::Emissor;

const BASE: &str = "https://api.z-api.io";
const TIMEOUT_S: u64 = 15;

/// Credenciais de uma instância — `instance_id` é identificador público;
/// os dois tokens são segredos do cofre.
#[derive(Debug, Clone)]
pub struct ZApiCredenciais {
    pub instance_id: String,
    pub instance_token: String,
    pub client_token: String,
}

impl ZApiCredenciais {
    /// `…/instances/{id}/token/{token}` — nunca logar o retorno.
    fn prefixo(&self) -> String {
        format!(
            "{BASE}/instances/{}/token/{}",
            self.instance_id, self.instance_token
        )
    }
}

fn http() -> Client {
    Client::builder()
        .timeout(std::time::Duration::from_secs(TIMEOUT_S))
        .build()
        .unwrap_or_else(|_| Client::new())
}

/// Erro de transporte — sem URL (carrega token no path).
fn erro_http(ctx: &str, e: &reqwest::Error) -> DomainError {
    let classe = if e.is_timeout() {
        "timeout"
    } else if e.is_connect() {
        "indisponível"
    } else {
        "falha de transporte"
    };
    DomainError::regra(format!("zapi.{ctx}: {classe}"))
}

/// Erro de status — só o código; o corpo pode repetir dados do path.
fn erro_status(ctx: &str, r: &reqwest::Response) -> DomainError {
    let st = r.status().as_u16();
    let classe = match st {
        401 | 403 => "credencial ou acesso negado",
        404 => "instância ou operação não encontrada",
        429 => "limite de chamadas",
        s if s >= 500 => "indisponibilidade do provedor",
        _ => "rejeição do provedor",
    };
    DomainError::regra(format!("zapi.{ctx}: HTTP {st} — {classe}"))
}

/// Resultado de `GET /status` interpretado.
#[derive(Debug)]
pub struct ZApiStatus {
    /// Sessão WhatsApp estabelecida.
    pub conectado: bool,
    pub smartphone_conectado: bool,
    /// Número vinculado quando o provedor o informa (`/device`).
    pub telefone: Option<String>,
    /// Mensagem do provedor, sanitizada (sem segredos).
    pub detalhe: Option<String>,
}

/// Resposta do QR Code — imagem base64 ou fluxo assistido (`challenge`).
#[derive(Debug)]
pub enum ZApiQr {
    Imagem(String),
    /// Verificação adicional — a UI orienta ao painel oficial.
    Assistido(String),
}

pub struct ZApiCliente {
    http: Client,
    cred: ZApiCredenciais,
}

impl ZApiCliente {
    pub fn new(cred: ZApiCredenciais) -> Self {
        Self { http: http(), cred }
    }

    fn get(&self, sufixo: &str) -> reqwest::RequestBuilder {
        self.http
            .get(format!("{}{}", self.cred.prefixo(), sufixo))
            .header("Client-Token", &self.cred.client_token)
    }

    fn put(&self, sufixo: &str) -> reqwest::RequestBuilder {
        self.http
            .put(format!("{}{}", self.cred.prefixo(), sufixo))
            .header("Client-Token", &self.cred.client_token)
    }

    /// Teste de conexão — consulta sem efeitos colaterais; interpreta
    /// `connected` em vez de presumir pelo HTTP 200.
    pub async fn status(&self) -> Result<ZApiStatus, DomainError> {
        let r = self
            .get("/status")
            .send()
            .await
            .map_err(|e| erro_http("status", &e))?;
        if !r.status().is_success() {
            return Err(erro_status("status", &r));
        }
        let v: serde_json::Value = r.json().await.map_err(|e| erro_http("status.parse", &e))?;
        Ok(ZApiStatus {
            conectado: v["connected"].as_bool().unwrap_or(false),
            smartphone_conectado: v["smartphoneConnected"].as_bool().unwrap_or(false),
            telefone: None,
            detalhe: v["error"].as_str().map(|s| s.chars().take(160).collect()),
        })
    }

    /// Número vinculado à sessão — `/device` (quando conectada).
    pub async fn telefone(&self) -> Result<Option<String>, DomainError> {
        let r = self
            .get("/device")
            .send()
            .await
            .map_err(|e| erro_http("device", &e))?;
        if !r.status().is_success() {
            return Err(erro_status("device", &r));
        }
        let v: serde_json::Value = r.json().await.map_err(|e| erro_http("device.parse", &e))?;
        Ok(v["phone"].as_str().map(str::to_string))
    }

    /// QR Code para pareamento — pode devolver imagem base64 ou um
    /// objeto `challenge` (fluxo assistido do provedor).
    pub async fn qr_code(&self) -> Result<ZApiQr, DomainError> {
        let r = self
            .get("/qr-code/image")
            .send()
            .await
            .map_err(|e| erro_http("qr", &e))?;
        if !r.status().is_success() {
            return Err(erro_status("qr", &r));
        }
        let v: serde_json::Value = r.json().await.map_err(|e| erro_http("qr.parse", &e))?;
        if let Some(img) = v["value"].as_str().or_else(|| v["image"].as_str()) {
            return Ok(ZApiQr::Imagem(img.to_string()));
        }
        // Verificação adicional — não renderizar como imagem.
        let hint = v["challenge"]
            .as_str()
            .or_else(|| v["message"].as_str())
            .unwrap_or("fluxo assistido: conclua o pareamento no painel oficial")
            .to_string();
        Ok(ZApiQr::Assistido(hint))
    }

    /// Envia texto — devolve `zaapId`/`messageId`/`id` do provedor
    /// (não intercambiáveis: `id` é a referência dos callbacks).
    pub async fn send_text(
        &self,
        phone: &str,
        message: &str,
    ) -> Result<serde_json::Value, DomainError> {
        let r = self
            .http
            .post(format!("{}/send-text", self.cred.prefixo()))
            .header("Client-Token", &self.cred.client_token)
            .json(&serde_json::json!({"phone": phone, "message": message}))
            .send()
            .await
            .map_err(|e| erro_http("send", &e))?;
        if !r.status().is_success() {
            return Err(erro_status("send", &r));
        }
        r.json().await.map_err(|e| erro_http("send.parse", &e))
    }

    /// Registra um callback — `nome` ∈ received | delivery |
    /// message-status | connected | disconnected.
    pub async fn update_webhook(&self, nome: &str, url: &str) -> Result<(), DomainError> {
        let sufixo = format!("/update-webhook-{nome}");
        let r = self
            .put(&sufixo)
            .json(&serde_json::json!({"value": url}))
            .send()
            .await
            .map_err(|e| erro_http("webhook", &e))?;
        if !r.status().is_success() {
            return Err(erro_status("webhook", &r));
        }
        Ok(())
    }

    /// Logout remoto da sessão — só por ação explícita do operador.
    pub async fn desconectar(&self) -> Result<(), DomainError> {
        let r = self
            .get("/disconnect")
            .send()
            .await
            .map_err(|e| erro_http("disconnect", &e))?;
        if !r.status().is_success() {
            return Err(erro_status("disconnect", &r));
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Emissor da fila — mesmo contrato dos demais (`send-text`).
// ---------------------------------------------------------------------------

pub struct ZApiEmissor {
    cli: ZApiCliente,
}

impl ZApiEmissor {
    pub fn new(cred: ZApiCredenciais) -> Self {
        Self {
            cli: ZApiCliente::new(cred),
        }
    }
}

#[async_trait]
impl Emissor for ZApiEmissor {
    fn canal(&self) -> CanalEnvio {
        CanalEnvio::Whatsapp
    }

    fn provedor(&self) -> &'static str {
        "zapi"
    }

    async fn enviar(
        &self,
        destino: &str,
        _template: &str,
        payload: &serde_json::Value,
    ) -> Result<Option<String>, DomainError> {
        // Só dígitos — o contrato rejeita formatos; `@lid` não é telefone.
        let digitos: String = destino.chars().filter(char::is_ascii_digit).collect();
        if digitos.len() < 10 || destino.contains('@') {
            return Err(DomainError::validacao("telefone inválido"));
        }
        let texto = payload["texto"].as_str().unwrap_or("");
        if texto.is_empty() {
            return Err(DomainError::validacao("mensagem vazia"));
        }
        let resp = self.cli.send_text(&digitos, texto).await?;
        // `id` é a referência usada pelos callbacks de status;
        // `messageId` fica composto pra reconciliação (`id|messageId`).
        let id = resp["id"].as_str();
        let msg = resp["messageId"].as_str();
        Ok(match (id, msg) {
            (Some(i), Some(m)) => Some(format!("{i}|{m}")),
            (Some(i), None) => Some(i.to_string()),
            _ => msg.map(|m| format!("|{m}")),
        })
    }
}
