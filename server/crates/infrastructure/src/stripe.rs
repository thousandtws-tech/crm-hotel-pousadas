//! Adapter Stripe — implementa `PaymentGateway` (domínio) via REST oficial.
//!
//! A API Stripe recebe `application/x-www-form-urlencoded` (não JSON) e
//! autentica por Bearer. Assinatura de webhook verificada por HMAC-SHA256
//! sobre o corpo bruto com comparação em tempo constante — rejeita replay
//! e payload adulterado antes de qualquer processamento.
//!
//! Segredos: `STRIPE_SECRET_KEY` e `STRIPE_WEBHOOK_SECRET` vivem só no
//! backend; nunca em logs nem no frontend.

use async_trait::async_trait;
use chrono::{TimeZone, Utc};
use clarituz_domain::enums::TipoPagamento;
use clarituz_domain::ports::{NovaCheckout, PaymentGateway, SessaoCheckout, StatusPi};
use clarituz_domain::DomainError;
use hmac::{Hmac, Mac};
use reqwest::{Client, StatusCode};
use serde::Deserialize;
use sha2::Sha256;
use std::time::Duration;
use subtle::ConstantTimeEq;
use tracing::{error, warn};
use uuid::Uuid;

type HmacSha256 = Hmac<Sha256>;

/// Tolerância da Stripe para o timestamp da assinatura (anti-replay).
const TOLERANCIA_ASSINATURA_SECS: i64 = 300;

pub struct StripeGateway {
    http: Client,
    /// sk_test_... / sk_live_... — nunca logada.
    secret: String,
    /// Injetável para testes (mock HTTP); produção = api.stripe.com.
    base_url: String,
}

impl StripeGateway {
    pub fn new(secret: String) -> Self {
        let http = Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .build()
            .unwrap_or_else(|_| Client::new());
        Self {
            http,
            secret,
            base_url: "https://api.stripe.com".into(),
        }
    }

    /// Construtor de teste — aponta para servidor mock local.
    #[cfg(test)]
    pub fn para_teste(secret: String, base_url: String) -> Self {
        let http = Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap_or_else(|_| Client::new());
        Self {
            http,
            secret,
            base_url,
        }
    }

    /// Mapeia erro de transporte/HTTP do provedor — detalhe no log,
    /// `Infra` genérico para o chamador (não vaza payload em resposta).
    fn erro_http(contexto: &str, e: &reqwest::Error) -> DomainError {
        error!(contexto, erro = %e, "stripe: falha de transporte");
        DomainError::Infra
    }

    fn erro_status(contexto: &str, status: StatusCode, corpo: &str) -> DomainError {
        warn!(contexto, status = %status, corpo = %corpo, "stripe: resposta de erro");
        match status {
            StatusCode::TOO_MANY_REQUESTS => DomainError::conflito(
                "Provedor de pagamento ocupado. Tente novamente em instantes.",
            ),
            s if s.is_client_error() => {
                DomainError::regra("Operação recusada pelo provedor de pagamento.")
            }
            _ => DomainError::Infra,
        }
    }

    async fn post_form<T: for<'de> Deserialize<'de>>(
        &self,
        contexto: &'static str,
        path: &str,
        form: &[(String, String)],
        idempotency_key: Uuid,
    ) -> Result<T, DomainError> {
        let resp = self
            .http
            .post(format!("{}{path}", self.base_url))
            .bearer_auth(&self.secret)
            .header("Idempotency-Key", idempotency_key.to_string())
            .form(form)
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
            error!(contexto, erro = %e, "stripe: resposta malformada");
            DomainError::Infra
        })
    }
}

#[derive(Deserialize)]
struct SessionResp {
    id: String,
    url: Option<String>,
    expires_at: i64,
    payment_intent: Option<String>,
}

#[derive(Deserialize)]
struct PiResp {
    status: String,
}

#[derive(Deserialize)]
struct RefundResp {
    id: String,
}

#[async_trait]
impl PaymentGateway for StripeGateway {
    async fn criar_checkout(&self, nova: &NovaCheckout) -> Result<SessaoCheckout, DomainError> {
        // Sessão expira junto do hold da reserva — Stripe exige 30min–24h.
        let expires_ts = nova.expires_em.timestamp().clamp(
            Utc::now().timestamp() + 1800,
            Utc::now().timestamp() + 86400,
        );
        let tipo = match nova.tipo {
            TipoPagamento::Integral => "integral",
            TipoPagamento::Sinal => "sinal",
            TipoPagamento::Saldo => "saldo",
        };
        let form = vec![
            ("mode".into(), "payment".into()),
            ("success_url".into(), nova.success_url.clone()),
            ("cancel_url".into(), nova.cancel_url.clone()),
            ("expires_at".into(), expires_ts.to_string()),
            // Pix habilitado na conta — Stripe expõe no checkout quando BRL.
            ("payment_method_types[0]".into(), "card".into()),
            ("payment_method_types[1]".into(), "pix".into()),
            ("line_items[0][quantity]".into(), "1".into()),
            ("line_items[0][price_data][currency]".into(), "brl".into()),
            (
                "line_items[0][price_data][unit_amount]".into(),
                nova.valor_centavos.to_string(),
            ),
            (
                "line_items[0][price_data][product_data][name]".into(),
                nova.descricao.clone(),
            ),
            ("metadata[idpagamento]".into(), nova.idpagamento.to_string()),
            ("metadata[idreserva]".into(), nova.idreserva.to_string()),
            ("metadata[tipo]".into(), tipo.into()),
            (
                "payment_intent_data[metadata][idpagamento]".into(),
                nova.idpagamento.to_string(),
            ),
            (
                "payment_intent_data[metadata][idreserva]".into(),
                nova.idreserva.to_string(),
            ),
        ];
        let s: SessionResp = self
            .post_form(
                "checkout.create",
                "/v1/checkout/sessions",
                &form,
                nova.idempotency_key,
            )
            .await?;
        Ok(SessaoCheckout {
            session_id: s.id,
            url: s.url.unwrap_or_default(),
            expires_em: Utc
                .timestamp_opt(s.expires_at, 0)
                .single()
                .unwrap_or_else(Utc::now),
            pi_id: s.payment_intent,
        })
    }

    async fn status_payment_intent(&self, pi_id: &str) -> Result<StatusPi, DomainError> {
        let resp = self
            .http
            .get(format!("{}/v1/payment_intents/{pi_id}", self.base_url))
            .bearer_auth(&self.secret)
            .send()
            .await
            .map_err(|e| Self::erro_http("pi.retrieve", &e))?;
        let status = resp.status();
        let corpo = resp
            .text()
            .await
            .map_err(|e| Self::erro_http("pi.retrieve", &e))?;
        if !status.is_success() {
            return Err(Self::erro_status("pi.retrieve", status, &corpo));
        }
        let pi: PiResp = serde_json::from_str(&corpo).map_err(|e| {
            error!(erro = %e, "stripe: payment_intent malformado");
            DomainError::Infra
        })?;
        Ok(match pi.status.as_str() {
            "succeeded" => StatusPi::Pago,
            "processing" => StatusPi::Processando,
            "requires_action"
            | "requires_payment_method"
            | "requires_confirmation"
            | "requires_capture" => StatusPi::RequerAcao,
            "canceled" => StatusPi::Cancelado,
            _ => StatusPi::Falhou,
        })
    }

    async fn reembolsar(
        &self,
        pi_id: &str,
        valor_centavos: i64,
        motivo: Option<&str>,
        idempotency_key: Uuid,
    ) -> Result<String, DomainError> {
        let mut form = vec![
            ("payment_intent".to_string(), pi_id.to_string()),
            ("amount".to_string(), valor_centavos.to_string()),
        ];
        if let Some(m) = motivo {
            form.push(("reason".to_string(), m.to_string()));
        }
        let r: RefundResp = self
            .post_form("refund.create", "/v1/refunds", &form, idempotency_key)
            .await?;
        Ok(r.id)
    }

    async fn expirar_sessao(&self, session_id: &str) -> Result<(), DomainError> {
        let _: serde_json::Value = self
            .post_form(
                "session.expire",
                &format!("/v1/checkout/sessions/{session_id}/expire"),
                &[],
                Uuid::new_v4(),
            )
            .await?;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// verificação de assinatura do webhook
// ---------------------------------------------------------------------------

/// Valida `Stripe-Signature` sobre o corpo **bruto** — `t={ts},v1={hex}`.
/// Retorna o timestamp do evento para checagem anti-replay adicional.
pub fn verificar_assinatura(
    webhook_secret: &str,
    corpo_bruto: &[u8],
    header_assinatura: &str,
) -> Result<(), DomainError> {
    let (mut ts, mut v1) = (None, None);
    for parte in header_assinatura.split(',') {
        if let Some((k, v)) = parte.split_once('=') {
            match k.trim() {
                "t" => ts = v.parse::<i64>().ok(),
                "v1" => v1 = Some(v.to_string()),
                _ => {}
            }
        }
    }
    let (Some(ts), Some(v1)) = (ts, v1) else {
        return Err(DomainError::nao_autenticado(
            "Assinatura de webhook malformada.",
        ));
    };

    // Anti-replay: evento antigo demais é rejeitado mesmo com assinatura válida.
    let agora = Utc::now().timestamp();
    if (agora - ts).abs() > TOLERANCIA_ASSINATURA_SECS {
        return Err(DomainError::nao_autenticado(
            "Webhook fora da janela de tolerância.",
        ));
    }

    let mut mac = <HmacSha256 as Mac>::new_from_slice(webhook_secret.as_bytes())
        .map_err(|_| DomainError::Infra)?;
    mac.update(ts.to_string().as_bytes());
    mac.update(b".");
    mac.update(corpo_bruto);
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

    fn assinar(secret: &str, corpo: &[u8], ts: i64) -> String {
        let mut mac = <HmacSha256 as Mac>::new_from_slice(secret.as_bytes()).unwrap();
        mac.update(ts.to_string().as_bytes());
        mac.update(b".");
        mac.update(corpo);
        format!("t={ts},v1={}", hex::encode(mac.finalize().into_bytes()))
    }

    #[test]
    fn assinatura_valida_aceita() {
        let segredo = "whsec_teste";
        let corpo = br#"{"id":"evt_1","type":"checkout.session.completed"}"#;
        let header = assinar(segredo, corpo, Utc::now().timestamp());
        assert!(verificar_assinatura(segredo, corpo, &header).is_ok());
    }

    #[test]
    fn assinatura_invalida_rejeita() {
        let corpo = b"{}";
        let header = format!("t={},v1=assinatura_errada", Utc::now().timestamp());
        assert!(verificar_assinatura("whsec_x", corpo, &header).is_err());
    }

    #[test]
    fn timestamp_antigo_rejeita() {
        let segredo = "whsec_teste";
        let corpo = b"{}";
        let header = assinar(segredo, corpo, Utc::now().timestamp() - 600);
        assert!(verificar_assinatura(segredo, corpo, &header).is_err());
    }

    #[test]
    fn header_malformado_rejeita() {
        assert!(verificar_assinatura("whsec_x", b"{}", "lixo").is_err());
    }
}
