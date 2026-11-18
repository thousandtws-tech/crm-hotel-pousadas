//! Adaptador Channex — channel manager (PMS → Channex → OTAs).
//!
//! - Autenticação `user-api-key`; hosts oficiais fixos por ambiente
//!   (staging.channex.io / app.channex.io).
//! - ARI assíncrono: 2xx carrega `data` com task ids + `meta.warnings`
//!   com objetos rejeitados — aceite parcial nunca é sucesso pleno.
//! - Webhook: `x-hmac-timestamp` + `x-hmac-signature-256` (hex,
//!   lista separada por vírgula na rotação) sobre `{ts}.{corpo cru}`,
//!   tolerância de 5 min, comparação em tempo constante.
//! - Booking revisions são aplicadas só após leitura autenticada —
//!   entregas de webhook são sinal, nunca verdade (doc. oficial).

use async_trait::async_trait;
use hmac::{Hmac, Mac};
use reqwest::Client;
use sha2::Sha256;

use clarituz_domain::entities::AmbienteIntegracao;
use clarituz_domain::error::DomainError;
use clarituz_domain::ports::{
    DisponibilidadeValor, ErroDistribuicao, PropriedadeRemota, ProvedorDistribuicao,
    RatePlanRemota, RespostaAri, RestricaoValor, RevisaoRemota, RoomTypeRemota, TokenCanal,
};

const TIMEOUT_S: u64 = 20;
const TOLERANCIA_TS_S: i64 = 300;

fn base(ambiente: AmbienteIntegracao) -> &'static str {
    match ambiente {
        AmbienteIntegracao::Producao => "https://app.channex.io/api/v1",
        AmbienteIntegracao::Teste => "https://staging.channex.io/api/v1",
    }
}

fn http() -> Client {
    Client::builder()
        .timeout(std::time::Duration::from_secs(TIMEOUT_S))
        .build()
        .unwrap_or_else(|_| Client::new())
}

fn erro_http(ctx: &str, e: &reqwest::Error) -> ErroDistribuicao {
    let classe = if e.is_timeout() {
        "timeout"
    } else if e.is_connect() {
        "indisponível"
    } else {
        "falha de transporte"
    };
    ErroDistribuicao::Transiente(format!("channex.{ctx}: {classe}"))
}

async fn erro_status(ctx: &str, r: reqwest::Response) -> ErroDistribuicao {
    let st = r.status().as_u16();
    let retry_after = r
        .headers()
        .get("retry-after")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<i64>().ok());
    let detalhe = r
        .json::<serde_json::Value>()
        .await
        .ok()
        .and_then(|v| {
            v["errors"]["title"]
                .as_str()
                .or_else(|| v["errors"]["details"].as_str())
                .or_else(|| v["message"].as_str())
                .map(|s| s.chars().take(200).collect::<String>())
        })
        .unwrap_or_default();
    if st == 429 {
        return ErroDistribuicao::RateLimit {
            retry_after_secs: retry_after.unwrap_or(60),
        };
    }
    let classe = match st {
        401 | 403 => "credencial inválida ou acesso negado",
        404 => "recurso não encontrado no provedor",
        409 => "conflito de estado no provedor",
        422 => "rejeição de dados pelo provedor",
        s if s >= 500 => "indisponibilidade do provedor",
        _ => "resposta inesperada do provedor",
    };
    let msg = if detalhe.is_empty() {
        format!("channex.{ctx}: HTTP {st} — {classe}")
    } else {
        format!("channex.{ctx}: HTTP {st} — {classe} ({detalhe})")
    };
    match st {
        s if s >= 500 => ErroDistribuicao::Transiente(msg),
        _ => ErroDistribuicao::Definitivo(msg),
    }
}

/// Envelope JSON:API — `data[]` de recursos `type` + `attributes`.
fn recursos(v: &serde_json::Value, tipo: &str) -> Vec<serde_json::Value> {
    v["data"].as_array().map_or_default(|a| {
        a.iter()
            .filter(|r| r["type"].as_str() == Some(tipo) || tipo.is_empty())
            .map(|r| {
                let mut attrs = r["attributes"].clone();
                // `id` sempre presente no nível do recurso — garante
                // quando o attribute omitir.
                if attrs["id"].is_null() {
                    attrs["id"] = r["id"].clone();
                }
                attrs
            })
            .collect()
    })
}

pub struct ChannexCliente {
    http: Client,
    api_key: String,
    base: &'static str,
}

impl ChannexCliente {
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
            .header("user-api-key", &self.api_key)
    }

    fn post(&self, sufixo: &str) -> reqwest::RequestBuilder {
        self.http
            .post(format!("{}{}", self.base, sufixo))
            .header("user-api-key", &self.api_key)
    }

    async fn json_or_err(
        ctx: &str,
        r: reqwest::Response,
    ) -> Result<serde_json::Value, ErroDistribuicao> {
        if !r.status().is_success() {
            return Err(erro_status(ctx, r).await);
        }
        r.json::<serde_json::Value>()
            .await
            .map_err(|_| ErroDistribuicao::Malformado(format!("channex.{ctx}: JSON inválido")))
    }

    fn revisao_de(v: &serde_json::Value) -> Result<RevisaoRemota, ErroDistribuicao> {
        let attrs = if v["type"].as_str() == Some("booking_revision") {
            let mut a = v["attributes"].clone();
            if a["id"].is_null() {
                a["id"] = v["id"].clone();
            }
            // `property_id` mora em `relationships.data.property.id`,
            // não em attributes — sem ele o struct falha e o feed
            // inteiro aborta antes de qualquer ingestão.
            if a["property_id"].is_null() {
                a["property_id"] = v["relationships"]["data"]["property"]["id"].clone();
            }
            a
        } else {
            v.clone()
        };
        let mut rev: RevisaoRemota = serde_json::from_value(attrs.clone())
            .map_err(|e| ErroDistribuicao::Malformado(format!("revision: {e}")))?;
        rev.raw = attrs;
        Ok(rev)
    }
}

#[async_trait]
impl ProvedorDistribuicao for ChannexCliente {
    /// Leitura autenticada mínima — 1 propriedade prova credencial+escopo.
    async fn testar(&self) -> Result<String, ErroDistribuicao> {
        let r = self
            .get("/properties?limit=1")
            .send()
            .await
            .map_err(|e| erro_http("testar", &e))?;
        let v = Self::json_or_err("testar", r).await?;
        let n = v["meta"]["total"].as_i64().unwrap_or(0);
        Ok(format!("{n} propriedade(s) na conta"))
    }

    async fn propriedades(&self) -> Result<Vec<PropriedadeRemota>, ErroDistribuicao> {
        let r = self
            .get("/properties/options")
            .send()
            .await
            .map_err(|e| erro_http("properties", &e))?;
        let v = Self::json_or_err("properties", r).await?;
        Ok(recursos(&v, "")
            .iter()
            .map(|a| PropriedadeRemota {
                id: a["id"].as_str().unwrap_or_default().to_string(),
                title: a["title"].as_str().unwrap_or_default().to_string(),
                currency: a["currency"].as_str().map(str::to_string),
                is_active: a["is_active"].as_bool(),
            })
            .collect())
    }

    async fn room_types(&self, property_id: &str) -> Result<Vec<RoomTypeRemota>, ErroDistribuicao> {
        let r = self
            .get(&format!(
                "/room_types/options?filter[property_id]={property_id}"
            ))
            .send()
            .await
            .map_err(|e| erro_http("room_types", &e))?;
        let v = Self::json_or_err("room_types", r).await?;
        Ok(recursos(&v, "room_type")
            .iter()
            .map(|a| RoomTypeRemota {
                id: a["id"].as_str().unwrap_or_default().to_string(),
                property_id: a["property_id"].as_str().unwrap_or_default().to_string(),
                title: a["title"].as_str().unwrap_or_default().to_string(),
                occupancy: (a["occ_adults"].as_i64().unwrap_or(0)
                    + a["occ_children"].as_i64().unwrap_or(0)) as i32,
                count_of_rooms: None,
            })
            .collect())
    }

    async fn rate_plans(&self, property_id: &str) -> Result<Vec<RatePlanRemota>, ErroDistribuicao> {
        let r = self
            .get(&format!(
                "/rate_plans/options?filter[property_id]={property_id}"
            ))
            .send()
            .await
            .map_err(|e| erro_http("rate_plans", &e))?;
        let v = Self::json_or_err("rate_plans", r).await?;
        Ok(recursos(&v, "rate_plan")
            .iter()
            .map(|a| RatePlanRemota {
                id: a["id"].as_str().unwrap_or_default().to_string(),
                property_id: a["property_id"].as_str().unwrap_or_default().to_string(),
                room_type_id: a["room_type_id"].as_str().unwrap_or_default().to_string(),
                title: a["title"].as_str().unwrap_or_default().to_string(),
                occupancy: a["occupancy"].as_i64().unwrap_or(0) as i32,
                rate_mode: a["rate_mode"].as_str().map(str::to_string),
            })
            .collect())
    }

    async fn enviar_disponibilidade(
        &self,
        valores: &[DisponibilidadeValor],
    ) -> Result<RespostaAri, ErroDistribuicao> {
        let corpo = serde_json::json!({ "values": valores });
        let r = self
            .post("/availability")
            .json(&corpo)
            .send()
            .await
            .map_err(|e| erro_http("availability", &e))?;
        let v = Self::json_or_err("availability", r).await?;
        serde_json::from_value(v)
            .map_err(|e| ErroDistribuicao::Malformado(format!("availability.resp: {e}")))
    }

    async fn enviar_restricoes(
        &self,
        valores: &[RestricaoValor],
    ) -> Result<RespostaAri, ErroDistribuicao> {
        let corpo = serde_json::json!({ "values": valores });
        let r = self
            .post("/restrictions")
            .json(&corpo)
            .send()
            .await
            .map_err(|e| erro_http("restrictions", &e))?;
        let v = Self::json_or_err("restrictions", r).await?;
        serde_json::from_value(v)
            .map_err(|e| ErroDistribuicao::Malformado(format!("restrictions.resp: {e}")))
    }

    async fn feed_revisoes(
        &self,
        property_id: &str,
    ) -> Result<Vec<RevisaoRemota>, ErroDistribuicao> {
        let r = self
            .get(&format!(
                "/booking_revisions/feed?filter[property_id]={property_id}&order[inserted_at]=asc&limit=100"
            ))
            .send()
            .await
            .map_err(|e| erro_http("feed", &e))?;
        let v = Self::json_or_err("feed", r).await?;
        v["data"]
            .as_array()
            .unwrap_or(&vec![])
            .iter()
            .map(Self::revisao_de)
            .collect()
    }

    async fn revisao(&self, revision_id: &str) -> Result<RevisaoRemota, ErroDistribuicao> {
        let r = self
            .get(&format!("/booking_revisions/{revision_id}"))
            .send()
            .await
            .map_err(|e| erro_http("revision", &e))?;
        let v = Self::json_or_err("revision", r).await?;
        Self::revisao_de(&v["data"])
    }

    async fn ack_revisao(&self, revision_id: &str) -> Result<(), ErroDistribuicao> {
        let r = self
            .post(&format!("/booking_revisions/{revision_id}/ack"))
            .send()
            .await
            .map_err(|e| erro_http("ack", &e))?;
        if !r.status().is_success() {
            return Err(erro_status("ack", r).await);
        }
        Ok(())
    }

    async fn token_iframe(&self, property_id: &str) -> Result<TokenCanal, ErroDistribuicao> {
        let r = self
            .post("/auth/one_time_token")
            .json(&serde_json::json!({ "property_id": property_id }))
            .send()
            .await
            .map_err(|e| erro_http("one_time_token", &e))?;
        let v = Self::json_or_err("one_time_token", r).await?;
        // Resposta pode vir envelope JSON:API ou plana — aceita ambas.
        let attrs = if v["data"]["attributes"].is_object() {
            &v["data"]["attributes"]
        } else {
            &v["data"]
        };
        Ok(TokenCanal {
            token: attrs["token"]
                .as_str()
                .or_else(|| attrs["access_token"].as_str())
                .unwrap_or_default()
                .to_string(),
            expires_in: attrs["expires_in"].as_i64(),
        })
    }

    /// Cria webhook assinado: signing key (billing da propriedade) +
    /// webhook `booking_revision` com `send_data` — o segredo retorna
    /// uma única vez e vai direto pro cofre.
    async fn registrar_webhook(
        &self,
        property_id: &str,
        callback_url: &str,
    ) -> Result<(String, Option<String>), ErroDistribuicao> {
        // Billing account da propriedade — necessária pra signing key.
        let r = self
            .get(&format!("/properties/{property_id}"))
            .send()
            .await
            .map_err(|e| erro_http("webhook.property", &e))?;
        let v = Self::json_or_err("webhook.property", r).await?;
        let billing = v["data"]["attributes"]["billing_account_id"]
            .as_str()
            .or_else(|| v["data"]["relationships"]["billing_account"]["data"]["id"].as_str())
            .map(str::to_string);

        let mut signing: Option<(String, String)> = None; // (key_id, secret)
        if let Some(ba) = billing {
            let r = self
                .post("/signing_keys")
                .json(&serde_json::json!({
                    "billing_account_id": ba,
                    "title": "crm-pousada-webhook"
                }))
                .send()
                .await
                .map_err(|e| erro_http("webhook.signing_key", &e))?;
            if r.status().is_success() {
                let v = Self::json_or_err("webhook.signing_key", r).await?;
                let key_id = v["data"]["id"].as_str().unwrap_or_default().to_string();
                let secret = v["data"]["attributes"]["secret"]
                    .as_str()
                    .map(str::to_string);
                if let (kid, Some(sec)) = (key_id, secret) {
                    if !kid.is_empty() {
                        signing = Some((kid, sec));
                    }
                }
            }
            // 403/422 → conta sem permissão de owner: segue sem assinatura
            // e a pendência operacional orienta a ativação manual.
        }

        let mut corpo = serde_json::json!({
            "property_id": property_id,
            "callback_url": callback_url,
            "event_mask": "booking_revision",
            "is_active": true,
            "send_data": true,
        });
        if let Some((kid, _)) = &signing {
            corpo["is_signed"] = serde_json::json!(true);
            corpo["signing_key_id"] = serde_json::json!(kid);
        }
        let r = self
            .post("/webhooks")
            .json(&corpo)
            .send()
            .await
            .map_err(|e| erro_http("webhook.create", &e))?;
        let v = Self::json_or_err("webhook.create", r).await?;
        let wid = v["data"]["id"].as_str().unwrap_or_default().to_string();
        Ok((wid, signing.map(|(_, s)| s)))
    }
}

// ---------------------------------------------------------------------------
// Assinatura de webhook — `x-hmac-timestamp` (s) +
// `x-hmac-signature-256` (hex csv) sobre `{ts}.{corpo cru}`.
// ---------------------------------------------------------------------------

/// Verifica a assinatura HMAC-SHA256 contra a lista do header (rotação
/// aceita qualquer assinatura). `segredo` é o secret cru da signing key.
pub fn verificar_assinatura(
    segredo: &str,
    timestamp: &str,
    corpo: &[u8],
    assinaturas_header: &str,
) -> Result<bool, DomainError> {
    let ts: i64 = timestamp
        .parse()
        .map_err(|_| DomainError::validacao("x-hmac-timestamp inválido"))?;
    if (chrono::Utc::now().timestamp() - ts).abs() > TOLERANCIA_TS_S {
        return Ok(false);
    }

    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(segredo.as_bytes())
        .map_err(|_| DomainError::regra("hmac: chave inválida"))?;
    mac.update(timestamp.as_bytes());
    mac.update(b".");
    mac.update(corpo);
    let esperado = hex::encode(mac.finalize().into_bytes());

    // CSV de assinaturas hex — durante rotação chegam 2; basta uma.
    for sig in assinaturas_header.split(',').map(str::trim) {
        if sig.len() == esperado.len() {
            let diff: u8 = sig
                .bytes()
                .zip(esperado.bytes())
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

    fn assinar(segredo: &str, ts: &str, corpo: &[u8]) -> String {
        let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(segredo.as_bytes()).unwrap();
        mac.update(ts.as_bytes());
        mac.update(b".");
        mac.update(corpo);
        hex::encode(mac.finalize().into_bytes())
    }

    #[test]
    fn assinatura_valida() {
        let ts = chrono::Utc::now().timestamp().to_string();
        let corpo = br#"{"event":"booking_revision"}"#;
        let header = assinar("segredo-x", &ts, corpo);
        assert!(verificar_assinatura("segredo-x", &ts, corpo, &header).unwrap());
    }

    #[test]
    fn rejeita_corpo_alterado_ts_antigo_e_lista_rotacao() {
        let corpo = br#"{"a":1}"#;
        let ts_novo = chrono::Utc::now().timestamp().to_string();
        let header = assinar("segredo-x", &ts_novo, corpo);
        assert!(!verificar_assinatura("segredo-x", &ts_novo, br#"{"a":2}"#, &header).unwrap());

        let ts_velho = (chrono::Utc::now().timestamp() - 600).to_string();
        let header_velho = assinar("segredo-x", &ts_velho, corpo);
        assert!(!verificar_assinatura("segredo-x", &ts_velho, corpo, &header_velho).unwrap());

        // Rotação: a assinatura válida em qualquer posição da lista aceita.
        let rot = format!("deadbeef,{header}");
        assert!(verificar_assinatura("segredo-x", &ts_novo, corpo, &rot).unwrap());
    }

    #[test]
    fn revision_parse_jsonapi() {
        let v = serde_json::json!({
            "type": "booking_revision",
            "id": "rev-1",
            "attributes": {
                "id": "rev-1",
                "property_id": "prop-1",
                "booking_id": "b-1",
                "status": "new",
                "ota_name": "Booking.com",
                "rooms": [{
                    "checkin_date": "2026-11-17",
                    "checkout_date": "2026-11-18",
                    "room_type_id": "rt-1",
                    "rate_plan_id": "rp-1",
                    "days": {"2026-11-17": "450.00"},
                    "occupancy": {"adults": 2, "children": 0, "infants": 0}
                }],
                "customer": {"name": "Ana", "surname": "Silva"},
                "arrival_date": "2026-11-17",
                "departure_date": "2026-11-18",
                "amount": "450.00",
                "currency": "BRL"
            }
        });
        let rev = ChannexCliente::revisao_de(&v).unwrap();
        assert_eq!(rev.id, "rev-1");
        assert_eq!(rev.rooms.len(), 1);
        assert_eq!(rev.rooms[0].days["2026-11-17"].to_string(), "450.00");
    }

    #[test]
    fn revision_parse_property_em_relationships() {
        // Forma real da API: `property_id` mora em relationships,
        // não em attributes — sem o fallback o feed inteiro aborta.
        let v = serde_json::json!({
            "type": "booking_revision",
            "id": "rev-2",
            "attributes": {
                "booking_id": "b-2",
                "status": "new",
                "rooms": [{
                    "checkin_date": "2026-11-27",
                    "checkout_date": "2026-11-28",
                    "room_type_id": "rt-9",
                    "occupancy": {"adults": 1, "children": 1, "infants": 1}
                }],
                "customer": {"name": "Dev", "mail": "d@x.io"},
                "arrival_date": "2026-11-27",
                "departure_date": "2026-11-28"
            },
            "relationships": {
                "data": {
                    "property": {"id": "prop-real", "type": "property"},
                    "booking": {"id": "b-2", "type": "booking"}
                }
            }
        });
        let rev = ChannexCliente::revisao_de(&v).unwrap();
        assert_eq!(rev.property_id, "prop-real");
        assert_eq!(rev.rooms.len(), 1);
    }
}
