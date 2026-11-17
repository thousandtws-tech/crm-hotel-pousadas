//! Adaptador PagBank — Checkout PagBank (hospedado).
//!
//! Produto: `POST /checkouts` cria a sessão e devolve `links[PAY]` para
//! redirect; `GET /checkouts/{id}` + `GET /orders/{id}` consultam estado;
//! `POST /checkouts/{id}/deactivate` expira a sessão.
//!
//! Autenticidade de notificação: o modelo documentado é **fetch-back** —
//! o payload carrega a referência e o estado real vem de `GET` na API com
//! o token da conta (o payload nunca é fonte de verdade). Quando o
//! `x-authenticity-token` está configurado ele também é conferido.
//!
//! Status PagBank → `StatusPi`:
//! `PAID`→Pago · `AUTHORIZED`/`IN_ANALYSIS`/`WAITING`→Processando ·
//! `DECLINED`/`CANCELED`→Falhou · `EXPIRED`/`INACTIVE`→Cancelado.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use clarituz_domain::entities::AmbienteIntegracao;
use clarituz_domain::ports::{
    ConsultaPagamento, NovaCheckout, PaymentGateway, SessaoCheckout, StatusPi,
};
use clarituz_domain::DomainError;
use reqwest::{Client, StatusCode};
use serde::Deserialize;
use std::time::Duration;
use subtle::ConstantTimeEq;
use tracing::{error, warn};
use uuid::Uuid;

pub struct PagBankGateway {
    http: Client,
    token: String,
    base_url: String,
}

impl PagBankGateway {
    pub fn new(token: String, ambiente: AmbienteIntegracao) -> Self {
        let base_url = match ambiente {
            AmbienteIntegracao::Teste => "https://sandbox.api.pagseguro.com".to_string(),
            AmbienteIntegracao::Producao => "https://api.pagseguro.com".to_string(),
        };
        Self::com_base(token, base_url)
    }

    #[cfg(test)]
    pub fn para_teste(token: String, base_url: String) -> Self {
        Self::com_base(token, base_url)
    }

    fn com_base(token: String, base_url: String) -> Self {
        let http = Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .build()
            .unwrap_or_else(|_| Client::new());
        Self {
            http,
            token,
            base_url,
        }
    }

    fn erro_http(contexto: &str, e: &reqwest::Error) -> DomainError {
        error!(contexto, erro = %e, "pagbank: falha de transporte");
        DomainError::Infra
    }

    fn erro_status(contexto: &str, status: StatusCode, _corpo: &str) -> DomainError {
        warn!(contexto, status = %status, "pagbank: resposta de erro");
        match status {
            StatusCode::TOO_MANY_REQUESTS => {
                DomainError::conflito("Provedor de pagamento ocupado. Tente novamente.")
            }
            s if s.is_client_error() => {
                DomainError::regra("Operação recusada pelo provedor de pagamento.")
            }
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
            .bearer_auth(&self.token)
            .header("Accept", "application/json")
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
            error!(contexto, erro = %e, "pagbank: resposta malformada");
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
            .bearer_auth(&self.token)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .header("x-idempotency-key", idempotency_key.to_string())
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
            error!(contexto, erro = %e, "pagbank: resposta malformada");
            DomainError::Infra
        })
    }

    /// Mapeia status de ordem/charge PagBank ao estado normalizado.
    fn mapear_status(status: &str) -> StatusPi {
        match status.to_ascii_uppercase().as_str() {
            "PAID" => StatusPi::Pago,
            "CANCELED" | "INACTIVE" | "EXPIRED" => StatusPi::Cancelado,
            "DECLINED" | "ERROR" | "FAILED" => StatusPi::Falhou,
            // AUTHORIZED/IN_ANALYSIS/WAITING/PRE_AUTHORIZED e desconhecidos
            _ => StatusPi::Processando,
        }
    }
}

#[derive(Deserialize)]
struct CheckoutResp {
    id: String,
    #[serde(default)]
    links: Vec<LinkResp>,
    #[serde(default)]
    expiration_date: Option<String>,
}

#[derive(Deserialize)]
struct LinkResp {
    rel: String,
    href: String,
}

#[derive(Deserialize)]
struct OrdemResp {
    #[serde(default)]
    reference_id: Option<String>,
    #[serde(default)]
    charges: Vec<ChargeResp>,
}

#[derive(Deserialize)]
struct ChargeResp {
    id: String,
    status: String,
    #[serde(default)]
    payment_method: Option<MetodoResp>,
}

#[derive(Deserialize)]
struct MetodoResp {
    #[serde(rename = "type")]
    tipo: String,
}

#[async_trait]
impl PaymentGateway for PagBankGateway {
    fn provedor(&self) -> &'static str {
        "pagbank"
    }

    async fn criar_checkout(&self, nova: &NovaCheckout) -> Result<SessaoCheckout, DomainError> {
        let mut body = serde_json::json!({
            "reference_id": nova.idpagamento.to_string(),
            "expiration_date": nova.expires_em.to_rfc3339(),
            "customer_modifiable": false,
            "items": [{
                "reference_id": nova.idpagamento.to_string(),
                "name": nova.descricao,
                "quantity": 1,
                "unit_amount": nova.valor_centavos,
            }],
            "redirect_url": nova.success_url,
            "notification_urls": [],
            "payment_notification_urls": [],
            "additional_information": [{
                "key": "idpagamento",
                "value": nova.idpagamento.to_string(),
            }, {
                "key": "idreserva",
                "value": nova.idreserva.to_string(),
            }],
        });
        if let Some(p) = &nova.pagador {
            let mut customer = serde_json::Map::new();
            if !p.nome.trim().is_empty() {
                customer.insert("name".into(), p.nome.trim().into());
            }
            if let Some(email) = p.email.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                customer.insert("email".into(), email.into());
            }
            let doc: String = p.documento.chars().filter(|c| c.is_ascii_digit()).collect();
            if doc.len() == 11 || doc.len() == 14 {
                customer.insert("tax_id".into(), doc.into());
            }
            if !customer.is_empty() {
                body["customer"] = serde_json::Value::Object(customer);
            }
        }
        if let Some(url) = nova
            .notification_url
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            body["notification_urls"] = serde_json::json!([url]);
            body["payment_notification_urls"] = serde_json::json!([url]);
        }
        let c: CheckoutResp = self
            .post(
                "checkout.create",
                "/checkouts",
                &body,
                &nova.idempotency_key,
            )
            .await?;
        let url = c
            .links
            .iter()
            .find(|l| l.rel == "PAY")
            .map(|l| l.href.clone())
            .ok_or_else(|| {
                error!("pagbank: checkout sem link PAY");
                DomainError::Infra
            })?;
        let expires_em = c
            .expiration_date
            .as_deref()
            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
            .map_or(nova.expires_em, |d| d.with_timezone(&Utc));
        Ok(SessaoCheckout {
            session_id: c.id,
            url,
            expires_em,
            pi_id: None, // a ordem nasce no pagamento — chega via webhook
        })
    }

    /// Consulta autoritativa: ordem (`ORDE_*`) agrega as cobranças;
    /// cobrança (`CHAR_*`) tem status próprio. Devolve estado + a
    /// `reference_id` interna (nosso idpagamento) + método.
    async fn consultar_pagamento(&self, ref_id: &str) -> Result<ConsultaPagamento, DomainError> {
        if ref_id.starts_with("CHAR_") {
            let charge: ChargeResp = self
                .get("charge.get", &format!("/charges/{ref_id}"))
                .await?;
            return Ok(ConsultaPagamento {
                status: Self::mapear_status(&charge.status),
                referencia: None,
                id_provedor: Some(charge.id.clone()),
                metodo: charge.payment_method.map(|m| m.tipo.to_lowercase()),
            });
        }
        let ordem: OrdemResp = self.get("orders.get", &format!("/orders/{ref_id}")).await?;
        let pago = ordem
            .charges
            .iter()
            .find(|c| Self::mapear_status(&c.status) == StatusPi::Pago);
        let (status, metodo, id_provedor) = if let Some(c) = pago {
            (
                StatusPi::Pago,
                c.payment_method.as_ref().map(|m| m.tipo.to_lowercase()),
                Some(c.id.clone()),
            )
        } else {
            let status = ordem
                .charges
                .iter()
                .map(|c| Self::mapear_status(&c.status))
                .max_by_key(|s| match s {
                    StatusPi::Falhou => 2,
                    StatusPi::Cancelado => 1,
                    _ => 0,
                })
                .unwrap_or(StatusPi::Processando);
            (status, None, Some(ref_id.to_string()))
        };
        Ok(ConsultaPagamento {
            status,
            referencia: ordem.reference_id,
            id_provedor,
            metodo,
        })
    }

    async fn reembolsar(
        &self,
        ref_id: &str,
        valor_centavos: i64,
        _motivo: Option<&str>,
        idempotency_key: Uuid,
    ) -> Result<String, DomainError> {
        // PagBank: cancelamento de cobrança = reembolso de cobrança paga.
        let charge_id = if ref_id.starts_with("CHAR_") {
            ref_id.to_string()
        } else {
            let ordem: OrdemResp = self.get("orders.get", &format!("/orders/{ref_id}")).await?;
            ordem
                .charges
                .into_iter()
                .find(|c| Self::mapear_status(&c.status) == StatusPi::Pago)
                .map(|c| c.id)
                .ok_or_else(|| DomainError::regra("Pagamento sem cobrança reembolsável."))?
        };
        let body = serde_json::json!({ "amount": { "value": valor_centavos } });
        let resp: serde_json::Value = self
            .post(
                "charge.cancel",
                &format!("/charges/{charge_id}/cancel"),
                &body,
                &idempotency_key,
            )
            .await?;
        Ok(resp["id"].as_str().unwrap_or(&charge_id).to_string())
    }

    async fn expirar_sessao(&self, session_id: &str) -> Result<(), DomainError> {
        let _: serde_json::Value = self
            .post(
                "checkout.deactivate",
                &format!("/checkouts/{session_id}/deactivate"),
                &serde_json::json!({}),
                &Uuid::new_v4(),
            )
            .await?;
        Ok(())
    }

    /// `GET /checkouts/{id}` com id inexistente: `404` prova autenticação
    /// válida no produto Checkout sem criar objeto nem efeito financeiro;
    /// `401/403` = credencial inválida ou sem permissão.
    async fn testar_conexao(&self) -> Result<String, DomainError> {
        let resp = self
            .http
            .get(format!(
                "{}/checkouts/VERIFICACAO-INEXISTENTE",
                self.base_url
            ))
            .bearer_auth(&self.token)
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(|e| Self::erro_http("teste.conexao", &e))?;
        match resp.status() {
            StatusCode::NOT_FOUND | StatusCode::OK => Ok("autenticado".into()),
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => Err(DomainError::regra(
                "Credencial recusada pelo PagBank — verifique o token e as permissões.",
            )),
            s => Err(Self::erro_status("teste.conexao", s, "verificação")),
        }
    }
}

/// Confere `x-authenticity-token` quando o token esperado está configurado.
/// O modelo de autenticidade definitivo é o fetch-back (o estado só vem da
/// API) — este header é uma camada adicional opcional.
pub fn verificar_authenticity_token(esperado: &str, recebido: &str) -> Result<(), DomainError> {
    if esperado.as_bytes().ct_eq(recebido.as_bytes()).into() {
        Ok(())
    } else {
        Err(DomainError::nao_autenticado(
            "Token de autenticidade inválido.",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mapeamento_status() {
        assert_eq!(PagBankGateway::mapear_status("PAID"), StatusPi::Pago);
        assert_eq!(
            PagBankGateway::mapear_status("AUTHORIZED"),
            StatusPi::Processando
        );
        assert_eq!(PagBankGateway::mapear_status("DECLINED"), StatusPi::Falhou);
        assert_eq!(
            PagBankGateway::mapear_status("CANCELED"),
            StatusPi::Cancelado
        );
        assert_eq!(
            PagBankGateway::mapear_status("WAITING"),
            StatusPi::Processando
        );
    }

    #[test]
    fn authenticity_token() {
        assert!(verificar_authenticity_token("tok", "tok").is_ok());
        assert!(verificar_authenticity_token("tok", "outro").is_err());
    }
}
