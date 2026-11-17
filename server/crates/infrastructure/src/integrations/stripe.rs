use async_trait::async_trait;
use chrono::{TimeZone, Utc};
use clarituz_domain::enums::TipoPagamento;
use clarituz_domain::ports::{
    ConsultaPagamento, NovaCheckout, PaymentGateway, SessaoCheckout, StatusPi,
};
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

const TOLERANCIA_ASSINATURA_SECS: i64 = 300;

pub struct StripeGateway {
    http: Client,
    secret: String,
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
    #[serde(default)]
    metadata: std::collections::HashMap<String, String>,
    #[serde(default)]
    payment_method_types: Vec<String>,
}

#[derive(Deserialize)]
struct RefundResp {
    id: String,
}

#[async_trait]
impl PaymentGateway for StripeGateway {
    fn provedor(&self) -> &'static str {
        "stripe"
    }

    async fn criar_checkout(&self, nova: &NovaCheckout) -> Result<SessaoCheckout, DomainError> {
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

    async fn consultar_pagamento(&self, ref_id: &str) -> Result<ConsultaPagamento, DomainError> {
        let pi_id = ref_id;
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
        let status_pi = match pi.status.as_str() {
            "succeeded" => StatusPi::Pago,
            "processing" => StatusPi::Processando,
            "requires_action"
            | "requires_payment_method"
            | "requires_confirmation"
            | "requires_capture" => StatusPi::RequerAcao,
            "canceled" => StatusPi::Cancelado,
            _ => StatusPi::Falhou,
        };
        Ok(ConsultaPagamento {
            status: status_pi,
            referencia: pi.metadata.get("idpagamento").cloned(),
            id_provedor: Some(pi_id.to_string()),
            metodo: pi.payment_method_types.first().cloned(),
        })
    }

    async fn reembolsar(
        &self,
        ref_id: &str,
        valor_centavos: i64,
        motivo: Option<&str>,
        idempotency_key: Uuid,
    ) -> Result<String, DomainError> {
        let pi_id = ref_id;
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

    /// `GET /v1/account` — leitura autenticada sem efeito lateral;
    /// devolve `acct_…` como rótulo sanitizado da conta.
    async fn testar_conexao(&self) -> Result<String, DomainError> {
        #[derive(Deserialize)]
        struct AccountResp {
            id: String,
        }
        let resp = self
            .http
            .get(format!("{}/v1/account", self.base_url))
            .bearer_auth(&self.secret)
            .send()
            .await
            .map_err(|e| Self::erro_http("conta.get", &e))?;
        let status = resp.status();
        let corpo = resp
            .text()
            .await
            .map_err(|e| Self::erro_http("conta.get", &e))?;
        if !status.is_success() {
            return Err(Self::erro_status("conta.get", status, &corpo));
        }
        let a: AccountResp = serde_json::from_str(&corpo).map_err(|e| {
            error!(erro = %e, "stripe: account malformada");
            DomainError::Infra
        })?;
        Ok(a.id)
    }
}

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
