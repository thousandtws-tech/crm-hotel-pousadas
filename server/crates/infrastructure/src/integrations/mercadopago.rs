//! Adaptador Mercado Pago — Checkout Pro via Preferences (hospedado).
//!
//! Produto: `POST /checkout/preferences` devolve `init_point` para
//! redirect; estado real vem de `GET /v1/payments/{id}` (fetch-back);
//! `GET /v1/payments/search?external_reference=` reconcilia pagamentos
//! ainda sem payment_id.
//!
//! Webhook: `x-signature` HMAC-SHA256 sobre
//! `id:{data.id};request-id:{x-request-id};ts:{ts};` — com tolerância de
//! timestamp e comparação em tempo constante (mecanismo oficial).
//!
//! Status MP → `StatusPi`:
//! `approved`→Pago · `pending`/`in_process`/`authorized`→Processando ·
//! `rejected`→Falhou · `cancelled`/`refunded`/`charged_back`→Cancelado.

use async_trait::async_trait;
use chrono::Utc;
use clarituz_domain::ports::{
    ConsultaPagamento, NovaCheckout, PaymentGateway, SessaoCheckout, StatusPi,
};
use clarituz_domain::DomainError;
use hmac::{Hmac, Mac};
use reqwest::{Client, StatusCode};
use serde::Deserialize;
use sha2::Sha256;
use std::fmt::Write as _;
use std::time::Duration;
use subtle::ConstantTimeEq;
use tracing::{error, warn};
use uuid::Uuid;

type HmacSha256 = Hmac<Sha256>;

const TOLERANCIA_ASSINATURA_MS: i64 = 300_000;

pub struct MercadoPagoGateway {
    http: Client,
    access_token: String,
    base_url: String,
}

impl MercadoPagoGateway {
    pub fn new(access_token: String) -> Self {
        Self::com_base(access_token, "https://api.mercadopago.com".into())
    }

    #[cfg(test)]
    pub fn para_teste(access_token: String, base_url: String) -> Self {
        Self::com_base(access_token, base_url)
    }

    fn com_base(access_token: String, base_url: String) -> Self {
        let http = Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .build()
            .unwrap_or_else(|_| Client::new());
        Self {
            http,
            access_token,
            base_url,
        }
    }

    fn erro_http(contexto: &str, e: &reqwest::Error) -> DomainError {
        error!(contexto, erro = %e, "mercadopago: falha de transporte");
        DomainError::Infra
    }

    fn erro_status(contexto: &str, status: StatusCode, corpo: &str) -> DomainError {
        warn!(contexto, status = %status, "mercadopago: resposta de erro");
        // O MP devolve {"message": "...", "cause": [{"description": ...}]} —
        // a causa explica a recusa (token malformado, expirado, escopo).
        let detalhe = serde_json::from_str::<serde_json::Value>(corpo)
            .ok()
            .and_then(|v| {
                v["message"]
                    .as_str()
                    .or_else(|| v["error"].as_str())
                    .or_else(|| v["cause"].as_array()?.first()?["description"].as_str())
                    .map(|s| s.chars().take(180).collect::<String>())
            })
            .filter(|s| !s.is_empty());
        match status {
            StatusCode::TOO_MANY_REQUESTS => {
                DomainError::conflito("Provedor de pagamento ocupado. Tente novamente.")
            }
            s if s.is_client_error() => DomainError::regra(match detalhe {
                Some(d) => format!("Operação recusada pelo provedor: {d}"),
                None => "Operação recusada pelo provedor de pagamento.".into(),
            }),
            _ => DomainError::Infra,
        }
    }

    async fn get<T: for<'de> Deserialize<'de>>(
        &self,
        contexto: &'static str,
        path: &str,
    ) -> Result<T, DomainError> {
        let resp = self
            .http
            .get(format!("{}{path}", self.base_url))
            .bearer_auth(&self.access_token)
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
            error!(contexto, erro = %e, "mercadopago: resposta malformada");
            DomainError::Infra
        })
    }

    async fn post<T: for<'de> Deserialize<'de>>(
        &self,
        contexto: &'static str,
        path: &str,
        body: &serde_json::Value,
        idempotency_key: &Uuid,
    ) -> Result<T, DomainError> {
        let resp = self
            .http
            .post(format!("{}{path}", self.base_url))
            .bearer_auth(&self.access_token)
            .header("Content-Type", "application/json")
            .header("X-Idempotency-Key", idempotency_key.to_string())
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
            error!(contexto, erro = %e, "mercadopago: resposta malformada");
            DomainError::Infra
        })
    }

    fn mapear_status(status: &str) -> StatusPi {
        match status {
            "approved" => StatusPi::Pago,
            "rejected" => StatusPi::Falhou,
            "cancelled" | "refunded" | "charged_back" => StatusPi::Cancelado,
            // pending/in_process/authorized e desconhecidos → em processamento
            _ => StatusPi::Processando,
        }
    }
}

#[derive(Deserialize)]
struct PreferenceResp {
    id: String,
    init_point: Option<String>,
    sandbox_init_point: Option<String>,
}

#[derive(Deserialize)]
struct PaymentResp {
    id: i64,
    status: String,
    #[serde(default)]
    external_reference: Option<String>,
    #[serde(default)]
    payment_method_id: Option<String>,
}

#[derive(Deserialize)]
struct UserResp {
    id: i64,
    #[serde(default)]
    nickname: Option<String>,
}

#[derive(Deserialize)]
struct SearchResp {
    #[serde(default)]
    results: Vec<PaymentResp>,
}

#[async_trait]
impl PaymentGateway for MercadoPagoGateway {
    fn provedor(&self) -> &'static str {
        "mercadopago"
    }

    async fn criar_checkout(&self, nova: &NovaCheckout) -> Result<SessaoCheckout, DomainError> {
        let body = serde_json::json!({
            "items": [{
                "title": nova.descricao,
                "quantity": 1,
                "unit_price": nova.valor_centavos as f64 / 100.0,
                "currency_id": "BRL",
            }],
            "external_reference": nova.idpagamento.to_string(),
            "back_urls": {
                "success": nova.success_url,
                "failure": nova.cancel_url,
                "pending": nova.success_url,
            },
            "auto_return": "approved",
            "expires": true,
            "expiration_date_to": nova.expires_em.to_rfc3339(),
            "statement_descriptor": "POUSADA",
            // Sem exclusão de meios: cartão de crédito, débito, Pix e
            // boleto ficam à disposição do hóspede. `installments` é o
            // teto — o MP respeita o máximo da conta. `binary_mode` off
            // permite estados intermediários (análise/in_process).
            "binary_mode": false,
            "payment_methods": {
                "excluded_payment_methods": [],
                "excluded_payment_types": [],
                "installments": 12,
                "default_installments": 1
            },
        });
        let p: PreferenceResp = self
            .post(
                "preference.create",
                "/checkout/preferences",
                &body,
                &nova.idempotency_key,
            )
            .await?;
        let url = p.init_point.or(p.sandbox_init_point).ok_or_else(|| {
            error!("mercadopago: preferência sem init_point");
            DomainError::Infra
        })?;
        Ok(SessaoCheckout {
            session_id: p.id,
            url,
            expires_em: nova.expires_em,
            pi_id: None, // payment_id chega via webhook
        })
    }

    /// Consulta autoritativa: `payment_id` numérico consulta direto e, se
    /// não existir lá, cai na busca por `external_reference` — nosso
    /// `idpagamento` é numérico e o Checkout Pro só entrega o payment_id
    /// pelo webhook; sem ele a busca por referência é o único caminho.
    /// Devolve estado + `external_reference` (nosso idpagamento).
    async fn consultar_pagamento(&self, ref_id: &str) -> Result<ConsultaPagamento, DomainError> {
        if ref_id.chars().all(|c| c.is_ascii_digit()) {
            let direto: Result<PaymentResp, DomainError> = self
                .get("payment.get", &format!("/v1/payments/{ref_id}"))
                .await;
            match direto {
                Ok(p) => {
                    return Ok(ConsultaPagamento {
                        status: Self::mapear_status(&p.status),
                        referencia: p.external_reference,
                        id_provedor: Some(p.id.to_string()),
                        metodo: p.payment_method_id,
                    })
                }
                // 4xx = payment_id não existe → tenta external_reference.
                // Falha de transporte/5xx propaga (retry pelo reconciliador).
                Err(e @ DomainError::Infra) => return Err(e),
                Err(_) => {}
            }
        }
        let s: SearchResp = self
            .get(
                "payment.search",
                &format!("/v1/payments/search?external_reference={ref_id}&sort=date_created&criteria=desc&limit=1"),
            )
            .await?;
        Ok(match s.results.first() {
            Some(p) => ConsultaPagamento {
                status: Self::mapear_status(&p.status),
                referencia: p.external_reference.clone(),
                id_provedor: Some(p.id.to_string()),
                metodo: p.payment_method_id.clone(),
            },
            None => ConsultaPagamento {
                status: StatusPi::Processando,
                referencia: Some(ref_id.to_string()),
                id_provedor: None,
                metodo: None,
            },
        })
    }

    async fn reembolsar(
        &self,
        ref_id: &str,
        valor_centavos: i64,
        _motivo: Option<&str>,
        idempotency_key: Uuid,
    ) -> Result<String, DomainError> {
        let body = serde_json::json!({ "amount": valor_centavos as f64 / 100.0 });
        let r: serde_json::Value = self
            .post(
                "payment.refund",
                &format!("/v1/payments/{ref_id}/refunds"),
                &body,
                &idempotency_key,
            )
            .await?;
        Ok(r["id"]
            .as_i64()
            .map_or_else(|| ref_id.to_string(), |i| i.to_string()))
    }

    /// Checkout Pro não expõe expiração server-side da preferência —
    /// a sessão morre sozinha no `expiration_date_to`. Capability
    /// `checkout_expiravel: false` deve refletir isso na UI.
    async fn expirar_sessao(&self, _session_id: &str) -> Result<(), DomainError> {
        Err(DomainError::regra(
            "Mercado Pago não permite expirar sessão via API — ela expira na data configurada.",
        ))
    }

    /// `GET /users/me` — leitura autenticada da conta, sem efeito lateral.
    async fn testar_conexao(&self) -> Result<String, DomainError> {
        let u: UserResp = self.get("users.me", "/users/me").await?;
        Ok(format!(
            "mp-{}{}",
            u.id,
            u.nickname.map(|n| format!(" ({n})")).unwrap_or_default()
        ))
    }
}

/// Valida `x-signature` do Mercado Pago — manifesto oficial:
/// `id:{data.id};request-id:{x-request-id};ts:{ts};`
/// `data.id` alfanumérico entra minúsculo; pares ausentes são omitidos.
/// `ts` é em milissegundos com tolerância de 5 min.
pub fn verificar_assinatura(
    webhook_secret: &str,
    header_assinatura: &str,
    request_id: &str,
    data_id: &str,
) -> Result<(), DomainError> {
    let (mut ts, mut v1) = (None, None);
    for parte in header_assinatura.split(',') {
        if let Some((k, v)) = parte.split_once('=') {
            match k.trim() {
                "ts" => ts = v.trim().parse::<i64>().ok(),
                "v1" => v1 = Some(v.trim().to_string()),
                _ => {}
            }
        }
    }
    let (Some(ts), Some(v1)) = (ts, v1) else {
        return Err(DomainError::nao_autenticado(
            "Assinatura de webhook malformada.",
        ));
    };

    let agora_ms = Utc::now().timestamp_millis();
    if (agora_ms - ts).abs() > TOLERANCIA_ASSINATURA_MS {
        return Err(DomainError::nao_autenticado(
            "Webhook fora da janela de tolerância.",
        ));
    }

    let mut manifesto = String::new();
    if !data_id.is_empty() {
        let _ = write!(manifesto, "id:{};", data_id.to_lowercase());
    }
    if !request_id.is_empty() {
        let _ = write!(manifesto, "request-id:{request_id};");
    }
    let _ = write!(manifesto, "ts:{ts};");

    let mut mac = <HmacSha256 as Mac>::new_from_slice(webhook_secret.as_bytes())
        .map_err(|_| DomainError::Infra)?;
    mac.update(manifesto.as_bytes());
    let esperado = hex::encode(mac.finalize().into_bytes());

    if esperado.as_bytes().ct_eq(v1.as_bytes()).into() {
        Ok(())
    } else {
        Err(DomainError::nao_autenticado(
            "Assinatura de webhook inválida.",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assinar(secret: &str, data_id: &str, request_id: &str, ts: i64) -> String {
        let manifesto = format!("id:{data_id};request-id:{request_id};ts:{ts};");
        let mut mac = <HmacSha256 as Mac>::new_from_slice(secret.as_bytes()).unwrap();
        mac.update(manifesto.as_bytes());
        format!("ts={ts},v1={}", hex::encode(mac.finalize().into_bytes()))
    }

    #[test]
    fn assinatura_valida_aceita() {
        let ts = Utc::now().timestamp_millis();
        let h = assinar("segredo", "12345", "req-1", ts);
        assert!(verificar_assinatura("segredo", &h, "req-1", "12345").is_ok());
    }

    #[test]
    fn assinatura_invalida_rejeita() {
        let ts = Utc::now().timestamp_millis();
        assert!(verificar_assinatura("segredo", &format!("ts={ts},v1=xyz"), "r", "1").is_err());
    }

    #[test]
    fn timestamp_antigo_rejeita() {
        let ts = Utc::now().timestamp_millis() - 600_000;
        let h = assinar("segredo", "1", "r", ts);
        assert!(verificar_assinatura("segredo", &h, "r", "1").is_err());
    }

    #[test]
    fn mapeamento_status() {
        assert_eq!(
            MercadoPagoGateway::mapear_status("approved"),
            StatusPi::Pago
        );
        assert_eq!(
            MercadoPagoGateway::mapear_status("pending"),
            StatusPi::Processando
        );
        assert_eq!(
            MercadoPagoGateway::mapear_status("rejected"),
            StatusPi::Falhou
        );
        assert_eq!(
            MercadoPagoGateway::mapear_status("refunded"),
            StatusPi::Cancelado
        );
    }
}
