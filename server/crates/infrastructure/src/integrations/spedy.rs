//! Adaptador Spedy — provedor fiscal (NFS-e).
//!
//! - Autenticação `X-Api-Key` por empresa; hosts oficiais fixos por
//!   ambiente (api.spedy.com.br / sandbox-api.spedy.com.br).
//! - Emissão assíncrona: 2xx = enfileirada no provedor, nunca autorizada.
//! - Webhooks: Standard Webhooks — HMAC-SHA256 de `id.timestamp.body`,
//!   segredo base64 sem o prefixo `whsec_`, assinaturas `v1,<b64>`
//!   (múltiplas durante rotação), tolerância de 5 min, comparação em
//!   tempo constante.

use async_trait::async_trait;
use base64::Engine;
use hmac::{Hmac, Mac};
use reqwest::Client;
use sha2::Sha256;

use clarituz_domain::entities::AmbienteIntegracao;
use clarituz_domain::error::DomainError;
use clarituz_domain::ports::{EmpresaRemota, NotaRemota, ProvedorFiscal};

const TIMEOUT_S: u64 = 20;
const TOLERANCIA_TS_S: i64 = 300;

fn base(ambiente: AmbienteIntegracao) -> &'static str {
    match ambiente {
        AmbienteIntegracao::Producao => "https://api.spedy.com.br/v1",
        AmbienteIntegracao::Teste => "https://sandbox-api.spedy.com.br/v1",
    }
}

fn http() -> Client {
    Client::builder()
        .timeout(std::time::Duration::from_secs(TIMEOUT_S))
        .build()
        .unwrap_or_else(|_| Client::new())
}

fn erro_http(ctx: &str, e: &reqwest::Error) -> DomainError {
    let classe = if e.is_timeout() {
        "timeout"
    } else if e.is_connect() {
        "indisponível"
    } else {
        "falha de transporte"
    };
    DomainError::regra(format!("spedy.{ctx}: {classe}"))
}

async fn erro_status(ctx: &str, r: reqwest::Response) -> DomainError {
    let st = r.status().as_u16();
    // Mensagem do provedor é guardada para diagnóstico — sem ecoar
    // payload inteiro nem segredos (trunque e sanitize na exibição).
    let detalhe = r
        .json::<serde_json::Value>()
        .await
        .ok()
        .and_then(|v| {
            v["message"]
                .as_str()
                .or_else(|| v["error"].as_str())
                .map(|s| s.chars().take(200).collect::<String>())
        })
        .unwrap_or_default();
    let classe = match st {
        401 | 403 => "credencial inválida ou acesso negado",
        404 => "recurso não encontrado no provedor",
        409 => "conflito de estado no provedor",
        422 => "rejeição de dados pelo provedor",
        429 => "limite de chamadas do provedor",
        s if s >= 500 => "indisponibilidade do provedor",
        _ => "resposta inesperada do provedor",
    };
    let msg = if detalhe.is_empty() {
        format!("spedy.{ctx}: HTTP {st} — {classe}")
    } else {
        format!("spedy.{ctx}: HTTP {st} — {classe} ({detalhe})")
    };
    DomainError::regra(msg)
}

fn nota(v: &serde_json::Value) -> NotaRemota {
    NotaRemota {
        id: v["id"].as_str().unwrap_or_default().to_string(),
        status: v["status"].as_str().unwrap_or_default().to_string(),
        processing_detail: v["processingDetail"].as_str().map(str::to_string),
        number: v["number"]
            .as_str()
            .or_else(|| v["invoiceNumber"].as_str())
            .map(str::to_string),
        url: v["url"]
            .as_str()
            .or_else(|| v["accessUrl"].as_str())
            .map(str::to_string),
    }
}

pub struct SpedyCliente {
    http: Client,
    api_key: String,
    base: &'static str,
}

impl SpedyCliente {
    pub fn new(api_key: String, ambiente: AmbienteIntegracao) -> Self {
        Self {
            http: http(),
            api_key,
            base: base(ambiente),
        }
    }

    fn get(&self, sufixo: &str) -> reqwest::RequestBuilder {
        self.http
            .get(format!("{}{}", self.base, sufixo))
            .header("X-Api-Key", &self.api_key)
    }

    fn post(&self, sufixo: &str) -> reqwest::RequestBuilder {
        self.http
            .post(format!("{}{}", self.base, sufixo))
            .header("X-Api-Key", &self.api_key)
    }

    async fn json_or_err(
        ctx: &str,
        r: reqwest::Response,
    ) -> Result<serde_json::Value, DomainError> {
        if !r.status().is_success() {
            return Err(erro_status(ctx, r).await);
        }
        r.json::<serde_json::Value>()
            .await
            .map_err(|e| erro_http(&format!("{ctx}.parse"), &e))
    }

    /// Lista eventos de processamento de uma nota — trilha do provedor.
    pub async fn eventos(&self, remote_id: &str) -> Result<serde_json::Value, DomainError> {
        let r = self
            .get(&format!("/service-invoices/{remote_id}/events"))
            .send()
            .await
            .map_err(|e| erro_http("eventos", &e))?;
        Self::json_or_err("eventos", r).await
    }
}

#[async_trait]
impl ProvedorFiscal for SpedyCliente {
    async fn empresa(&self) -> Result<EmpresaRemota, DomainError> {
        // Chave por empresa — o próprio registro responde a identidade.
        let r = self
            .get("/companies/current")
            .send()
            .await
            .map_err(|e| erro_http("empresa", &e))?;
        let v = Self::json_or_err("empresa", r).await?;
        Ok(EmpresaRemota {
            id: v["id"].as_str().unwrap_or_default().to_string(),
            cnpj: v["federalTaxNumber"]
                .as_str()
                .or_else(|| v["cnpj"].as_str())
                .map(str::to_string),
            razao_social: v["name"]
                .as_str()
                .or_else(|| v["razaoSocial"].as_str())
                .map(str::to_string),
        })
    }

    async fn emitir(
        &self,
        integration_id: &str,
        payload: &serde_json::Value,
    ) -> Result<NotaRemota, DomainError> {
        let mut corpo = payload.clone();
        corpo["integrationId"] = serde_json::Value::String(integration_id.to_string());
        let r = self
            .post("/service-invoices")
            .json(&corpo)
            .send()
            .await
            .map_err(|e| erro_http("emitir", &e))?;
        let v = Self::json_or_err("emitir", r).await?;
        Ok(nota(&v))
    }

    async fn consultar(&self, remote_id: &str) -> Result<NotaRemota, DomainError> {
        let r = self
            .get(&format!("/service-invoices/{remote_id}"))
            .send()
            .await
            .map_err(|e| erro_http("consultar", &e))?;
        let v = Self::json_or_err("consultar", r).await?;
        Ok(nota(&v))
    }

    async fn reconciliar(&self, remote_id: &str) -> Result<NotaRemota, DomainError> {
        let r = self
            .post(&format!("/service-invoices/{remote_id}/check-status"))
            .send()
            .await
            .map_err(|e| erro_http("reconciliar", &e))?;
        let v = Self::json_or_err("reconciliar", r).await?;
        Ok(nota(&v))
    }

    async fn reprocessar(&self, remote_id: &str) -> Result<NotaRemota, DomainError> {
        let r = self
            .post(&format!("/service-invoices/{remote_id}/issue"))
            .send()
            .await
            .map_err(|e| erro_http("reprocessar", &e))?;
        let v = Self::json_or_err("reprocessar", r).await?;
        Ok(nota(&v))
    }

    async fn cancelar(&self, remote_id: &str, motivo: &str) -> Result<NotaRemota, DomainError> {
        let r = self
            .http
            .delete(format!("{}/service-invoices/{remote_id}", self.base))
            .header("X-Api-Key", &self.api_key)
            .json(&serde_json::json!({ "reason": motivo }))
            .send()
            .await
            .map_err(|e| erro_http("cancelar", &e))?;
        let v = Self::json_or_err("cancelar", r).await?;
        Ok(nota(&v))
    }

    async fn arquivo(&self, remote_id: &str, tipo: &str) -> Result<Vec<u8>, DomainError> {
        let sufixo = match tipo {
            "pdf" => "pdf",
            "xml" => "xml",
            _ => return Err(DomainError::validacao("tipo de arquivo inválido")),
        };
        let r = self
            .get(&format!("/service-invoices/{remote_id}/{sufixo}"))
            .send()
            .await
            .map_err(|e| erro_http("arquivo", &e))?;
        if !r.status().is_success() {
            return Err(erro_status("arquivo", r).await);
        }
        r.bytes()
            .await
            .map(|b| b.to_vec())
            .map_err(|e| erro_http("arquivo.bytes", &e))
    }

    async fn segredo_webhook(&self) -> Result<String, DomainError> {
        let r = self
            .get("/webhooks/secret")
            .send()
            .await
            .map_err(|e| erro_http("webhook.secret", &e))?;
        let v = Self::json_or_err("webhook.secret", r).await?;
        v["secret"]
            .as_str()
            .or_else(|| v["webhookSecret"].as_str())
            .map(str::to_string)
            .ok_or_else(|| DomainError::regra("spedy.webhook.secret: resposta sem segredo"))
    }

    async fn municipio_settings(&self, ibge: &str) -> Result<serde_json::Value, DomainError> {
        let r = self
            .get(&format!("/service-invoices/cities/{ibge}/settings"))
            .send()
            .await
            .map_err(|e| erro_http("municipio", &e))?;
        Self::json_or_err("municipio", r).await
    }

    async fn empresa_settings(&self) -> Result<serde_json::Value, DomainError> {
        let r = self
            .get("/companies/current/settings")
            .send()
            .await
            .map_err(|e| erro_http("settings", &e))?;
        Self::json_or_err("settings", r).await
    }

    /// Registra/atualiza o webhook — a Spedy mantém uma config por
    /// evento e o CRM só escreve em `invoice.status_changed`,
    /// preservando integrações alheias na mesma conta.
    async fn configurar_webhook(&self, url: &str) -> Result<serde_json::Value, DomainError> {
        let r = self
            .post("/webhooks")
            .json(&serde_json::json!({
                "event": "invoice.status_changed",
                "url": url,
            }))
            .send()
            .await
            .map_err(|e| erro_http("webhook.config", &e))?;
        Self::json_or_err("webhook.config", r).await
    }
}

// ---------------------------------------------------------------------------
// Assinatura Standard Webhooks — `webhook-id`, `webhook-timestamp`,
// `webhook-signature` = "v1,<b64>" (várias separadas por espaço na rotação).
// ---------------------------------------------------------------------------

/// Verifica a assinatura HMAC-SHA256 de `id.timestamp.body` contra as
/// assinaturas do header. `segredo` é o `whsec_*` cru — o prefixo é
/// removido antes do decode base64.
pub fn verificar_assinatura(
    segredo_whsec: &str,
    webhook_id: &str,
    webhook_timestamp: &str,
    corpo: &[u8],
    assinaturas_header: &str,
) -> Result<bool, DomainError> {
    // Tolerância de 5 min contra replay de eventos antigos.
    let ts: i64 = webhook_timestamp
        .parse()
        .map_err(|_| DomainError::validacao("webhook-timestamp inválido"))?;
    let agora = chrono::Utc::now().timestamp();
    if (agora - ts).abs() > TOLERANCIA_TS_S {
        return Ok(false);
    }

    let chave_b64 = segredo_whsec
        .strip_prefix("whsec_")
        .unwrap_or(segredo_whsec);
    let chave = base64::engine::general_purpose::STANDARD
        .decode(chave_b64)
        .map_err(|_| DomainError::validacao("segredo de webhook malformado"))?;

    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(&chave)
        .map_err(|_| DomainError::regra("hmac: chave inválida"))?;
    mac.update(webhook_id.as_bytes());
    mac.update(b".");
    mac.update(webhook_timestamp.as_bytes());
    mac.update(b".");
    mac.update(corpo);
    let esperado = mac.finalize().into_bytes();

    // Header pode trazer várias assinaturas (rotação de segredo) —
    // basta uma coincidir, sempre em tempo constante.
    for parte in assinaturas_header.split(' ') {
        let Some((versao, b64)) = parte.split_once(',') else {
            continue;
        };
        if versao != "v1" {
            continue;
        }
        let Ok(sig) = base64::engine::general_purpose::STANDARD.decode(b64.trim()) else {
            continue;
        };
        if sig.len() == esperado.len() {
            // XOR fold → comparação em tempo constante.
            let diff: u8 = sig
                .iter()
                .zip(esperado.iter())
                .fold(0u8, |acc, (a, b)| acc | (a ^ b));
            if diff == 0 {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn segredo_e_assinatura(id: &str, ts: &str, corpo: &[u8]) -> (String, String) {
        let chave_raw = [7u8; 32];
        let segredo = format!(
            "whsec_{}",
            base64::engine::general_purpose::STANDARD.encode(chave_raw)
        );
        let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(&chave_raw).unwrap();
        mac.update(id.as_bytes());
        mac.update(b".");
        mac.update(ts.as_bytes());
        mac.update(b".");
        mac.update(corpo);
        let sig = base64::engine::general_purpose::STANDARD.encode(mac.finalize().into_bytes());
        (segredo, format!("v1,{sig}"))
    }

    #[test]
    fn assinatura_valida() {
        let ts = chrono::Utc::now().timestamp().to_string();
        let corpo = br#"{"a":1}"#;
        let (segredo, header) = segredo_e_assinatura("evt_1", &ts, corpo);
        assert!(verificar_assinatura(&segredo, "evt_1", &ts, corpo, &header).unwrap());
    }

    #[test]
    fn rejeita_corpo_alterado_e_ts_antigo() {
        let corpo = br#"{"a":1}"#;
        let ts_novo = chrono::Utc::now().timestamp().to_string();
        let (segredo, header) = segredo_e_assinatura("evt_1", &ts_novo, corpo);
        assert!(
            !verificar_assinatura(&segredo, "evt_1", &ts_novo, br#"{"a":2}"#, &header).unwrap()
        );

        let ts_velho = (chrono::Utc::now().timestamp() - 600).to_string();
        let (_, header_velho) = segredo_e_assinatura("evt_1", &ts_velho, corpo);
        assert!(!verificar_assinatura(&segredo, "evt_1", &ts_velho, corpo, &header_velho).unwrap());
    }

    #[test]
    fn aceita_rotacao_de_assinaturas() {
        let ts = chrono::Utc::now().timestamp().to_string();
        let corpo = b"{}";
        let (segredo, header) = segredo_e_assinatura("evt_2", &ts, corpo);
        let header_rot = format!("v0,lixo v1,AAAA {header}");
        assert!(verificar_assinatura(&segredo, "evt_2", &ts, corpo, &header_rot).unwrap());
    }
}
