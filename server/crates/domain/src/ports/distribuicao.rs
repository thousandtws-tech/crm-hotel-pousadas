//! Ports da distribuição — a borda HTTP da Channex e a persistência
//! dos artefatos locais (mapeamentos, revisões, outbox, pendências).

use crate::entities::{
    EnvioDistribuicao, MapaDistribuicao, MapaDistribuicaoView, NovoOutboxAri,
    PendenciaDistribuicao, ReservaDistribuicao, ResumoDistribuicao, RevisaoDistribuicao,
};
use crate::error::DomainError;
use async_trait::async_trait;
use chrono::NaiveDate;
use serde::Deserialize;
use std::collections::BTreeMap;

// ---------------------------------------------------------------------------
// Borda HTTP — implementada pela infra (reqwest). A application nunca
// conhece reqwest/headers — só os DTOs abaixo.
// ---------------------------------------------------------------------------

/// Propriedade remota (Hotel) — usada no vínculo da integração.
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct PropriedadeRemota {
    pub id: String,
    pub title: String,
    pub currency: Option<String>,
    pub is_active: Option<bool>,
}

/// Room Type remota — opção de mapeamento.
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct RoomTypeRemota {
    pub id: String,
    pub property_id: String,
    pub title: String,
    pub occupancy: i32,
    pub count_of_rooms: Option<i32>,
}

/// Rate Plan remota — opção de mapeamento.
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct RatePlanRemota {
    pub id: String,
    pub property_id: String,
    pub room_type_id: String,
    pub title: String,
    pub occupancy: i32,
    /// `per_room` | `per_occupancy` — define se `rate` ou `rates[]` vão no ARI.
    pub rate_mode: Option<String>,
}

/// Uma mudança de disponibilidade — `POST /availability`.
#[derive(Debug, Clone, serde::Serialize)]
pub struct DisponibilidadeValor {
    pub property_id: String,
    pub room_type_id: String,
    pub date_from: NaiveDate,
    pub date_to: NaiveDate,
    /// Uma célula por dia — enviado como `availability` inteira por janela
    /// uniforme; dias diferentes viram valores separados (o caller fatia).
    pub availability: i32,
}

/// Uma mudança de tarifa/restrição — `POST /restrictions`.
#[derive(Debug, Clone, serde::Serialize)]
pub struct RestricaoValor {
    pub property_id: String,
    pub rate_plan_id: String,
    pub date_from: NaiveDate,
    pub date_to: NaiveDate,
    /// Tarifa por noite (per-room) — ignorada quando `rates` presente.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rate: Option<rust_decimal::Decimal>,
    /// Tarifa por ocupação — `[{"occupancy":N,"rate":X}]` do contrato.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rates: Option<Vec<OcupacaoTarifa>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_stay_through: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub closed_to_arrival: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub closed_to_departure: Option<bool>,
    /// Stop-sell — fecha vendas no período sem mexer na disponibilidade.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stop_sell: Option<bool>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OcupacaoTarifa {
    pub occupancy: i32,
    pub rate: rust_decimal::Decimal,
}

/// Resposta do update ARI — `data` = tasks por propriedade; `meta.warnings`
/// = objetos rejeitados (aceite parcial — nunca sucesso incondicional).
#[derive(Debug, Clone, serde::Deserialize, Default)]
pub struct RespostaAri {
    #[serde(default)]
    pub data: Vec<ReferenciaTask>,
    #[serde(default)]
    pub meta: MetaAri,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct ReferenciaTask {
    pub id: String,
    #[serde(rename = "type")]
    pub tipo: Option<String>,
}

#[derive(Debug, Clone, serde::Deserialize, Default)]
pub struct MetaAri {
    #[serde(default)]
    pub message: Option<String>,
    #[serde(default)]
    pub warnings: Vec<serde_json::Value>,
}

/// `inserted_at` da Channex chega sem offset ("2026-11-18T03:46:43.466334")
/// em parte dos endpoints e com RFC3339 em outros — aceita os dois,
/// assumindo UTC quando ingênuo.
fn de_dt_flexivel<'de, D>(d: D) -> Result<Option<chrono::DateTime<chrono::Utc>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let s: Option<String> = Option::deserialize(d)?;
    let Some(s) = s else { return Ok(None) };
    if let Ok(dt) = s.parse::<chrono::DateTime<chrono::Utc>>() {
        return Ok(Some(dt));
    }
    chrono::NaiveDateTime::parse_from_str(&s, "%Y-%m-%dT%H:%M:%S%.f")
        .map(|n| Some(n.and_utc()))
        .map_err(serde::de::Error::custom)
}

/// Revisão de booking crua — `attributes` do JSON:API, sem `rooms` ainda
/// desserializados (cada room vira uma reserva local).
#[derive(Debug, Clone, serde::Deserialize)]
pub struct RevisaoRemota {
    pub id: String,
    pub property_id: String,
    pub booking_id: Option<String>,
    pub unique_id: Option<String>,
    pub ota_reservation_code: Option<String>,
    pub ota_name: Option<String>,
    /// `new` | `modified` | `cancelled`.
    pub status: String,
    #[serde(default)]
    pub rooms: Vec<QuartoReservaRemota>,
    pub customer: Option<serde_json::Value>,
    pub occupancy: Option<OcupacaoRemota>,
    pub arrival_date: Option<NaiveDate>,
    pub departure_date: Option<NaiveDate>,
    pub amount: Option<rust_decimal::Decimal>,
    pub currency: Option<String>,
    pub notes: Option<String>,
    pub payment_collect: Option<String>,
    pub payment_type: Option<String>,
    #[serde(default, deserialize_with = "de_dt_flexivel")]
    pub inserted_at: Option<chrono::DateTime<chrono::Utc>>,
    /// Payload integral — gravado antes do ACK (PII some depois).
    #[serde(skip)]
    pub raw: serde_json::Value,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct QuartoReservaRemota {
    pub room_type_id: Option<String>,
    pub rate_plan_id: Option<String>,
    pub checkin_date: NaiveDate,
    pub checkout_date: NaiveDate,
    pub occupancy: Option<OcupacaoRemota>,
    pub amount: Option<rust_decimal::Decimal>,
    /// `{"2026-11-17": "450.00"}` — preço por noite da OTA.
    #[serde(default)]
    pub days: BTreeMap<String, rust_decimal::Decimal>,
    pub meta: Option<serde_json::Value>,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct OcupacaoRemota {
    #[serde(default)]
    pub adults: i32,
    #[serde(default)]
    pub children: i32,
    #[serde(default)]
    pub infants: i32,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct TokenCanal {
    /// Token temporário do Channel IFrame — nunca a API key.
    pub token: String,
    pub expires_in: Option<i64>,
}

/// Erro tipado do provedor — retry só nos transientes.
#[derive(Debug, thiserror::Error)]
pub enum ErroDistribuicao {
    #[error("Channex indisponível ou timeout: {0}")]
    Transiente(String),
    #[error("Rate limit — retry após {retry_after_secs}s")]
    RateLimit { retry_after_secs: i64 },
    #[error("Channex recusou (credencial/argumentos): {0}")]
    Definitivo(String),
    #[error("Resposta inesperada da Channex: {0}")]
    Malformado(String),
}

impl From<ErroDistribuicao> for DomainError {
    fn from(e: ErroDistribuicao) -> Self {
        match e {
            ErroDistribuicao::Transiente(m) => {
                DomainError::regra(format!("Falha de comunicação com a Channex: {m}"))
            }
            ErroDistribuicao::RateLimit { retry_after_secs } => DomainError::regra(format!(
                "Channex rate limit — retry após {retry_after_secs}s"
            )),
            ErroDistribuicao::Definitivo(m) => DomainError::regra(format!("Channex recusou: {m}")),
            ErroDistribuicao::Malformado(m) => {
                DomainError::regra(format!("Resposta inesperada da Channex: {m}"))
            }
        }
    }
}

#[async_trait]
pub trait ProvedorDistribuicao: Send + Sync {
    /// Leitura autenticada mínima — teste de conexão do card.
    async fn testar(&self) -> Result<String, ErroDistribuicao>;
    /// Propriedades da conta — vínculo da integração.
    async fn propriedades(&self) -> Result<Vec<PropriedadeRemota>, ErroDistribuicao>;
    /// Room types de uma propriedade — opções de mapeamento.
    async fn room_types(&self, property_id: &str) -> Result<Vec<RoomTypeRemota>, ErroDistribuicao>;
    /// Rate plans de uma propriedade — opções de mapeamento.
    async fn rate_plans(&self, property_id: &str) -> Result<Vec<RatePlanRemota>, ErroDistribuicao>;

    /// `POST /availability` — lotes de disponibilidade por room type.
    async fn enviar_disponibilidade(
        &self,
        valores: &[DisponibilidadeValor],
    ) -> Result<RespostaAri, ErroDistribuicao>;
    /// `POST /restrictions` — lotes de tarifa/restrição por rate plan.
    async fn enviar_restricoes(
        &self,
        valores: &[RestricaoValor],
    ) -> Result<RespostaAri, ErroDistribuicao>;

    /// Feed de revisões não-ACK — fonte primária de reservas inbound.
    async fn feed_revisoes(
        &self,
        property_id: &str,
    ) -> Result<Vec<RevisaoRemota>, ErroDistribuicao>;
    /// Uma revisão por id — complemento do webhook (o evento carrega só o id).
    async fn revisao(&self, revision_id: &str) -> Result<RevisaoRemota, ErroDistribuicao>;
    /// ACK — só depois do commit local; sem ACK a revisão volta no feed.
    async fn ack_revisao(&self, revision_id: &str) -> Result<(), ErroDistribuicao>;

    /// `POST /auth/one_time_token` — Channel IFrame no admin (token
    /// temporário; a API key nunca sai do backend).
    async fn token_iframe(&self, property_id: &str) -> Result<TokenCanal, ErroDistribuicao>;

    /// Cria signing key + webhook assinado para `booking_revision` —
    /// retorna `(webhook_id, signing_secret)` para o cofre.
    async fn registrar_webhook(
        &self,
        property_id: &str,
        callback_url: &str,
    ) -> Result<(String, Option<String>), ErroDistribuicao>;
}

// ---------------------------------------------------------------------------
// Persistência
// ---------------------------------------------------------------------------

#[async_trait]
pub trait DistribuicaoRepository: Send + Sync {
    // -- mapeamento -----------------------------------------------------
    async fn mapa_listar(
        &self,
        idintegracao: i64,
    ) -> Result<Vec<MapaDistribuicaoView>, DomainError>;
    async fn mapa_ativos(&self, idintegracao: i64) -> Result<Vec<MapaDistribuicao>, DomainError>;
    async fn mapa_por_acomodacao(
        &self,
        idintegracao: i64,
        idacomodacao: i64,
    ) -> Result<Option<MapaDistribuicao>, DomainError>;
    /// room_type_id → acomodação local ativa (resolução inbound).
    async fn mapa_por_room_type(
        &self,
        idintegracao: i64,
        room_type_id: &str,
    ) -> Result<Option<MapaDistribuicao>, DomainError>;
    async fn mapa_salvar(
        &self,
        idintegracao: i64,
        idacomodacao: i64,
        room_type_id: &str,
        rate_plan_id: &str,
    ) -> Result<MapaDistribuicao, DomainError>;
    async fn mapa_desativar(&self, id: i64) -> Result<(), DomainError>;

    // -- outbox ARI ------------------------------------------------------
    async fn outbox_enfileirar(&self, itens: &[NovoOutboxAri]) -> Result<(), DomainError>;
    /// Coalesce por acomodação: devolve um item por (idintegracao,
    /// idacomodacao) com a união das janelas — o estado enviado é sempre
    /// recalculado do banco, então janelas só controlam o período-alvo.
    async fn outbox_drenar(&self, limite: i64) -> Result<Vec<NovoOutboxAri>, DomainError>;

    // -- envios (auditoria ARI) ------------------------------------------
    async fn envio_registrar(
        &self,
        idintegracao: i64,
        tipo: &str,
        valores: &serde_json::Value,
        task_ids: &serde_json::Value,
        warnings: &serde_json::Value,
    ) -> Result<(), DomainError>;
    async fn envio_listar(
        &self,
        idintegracao: i64,
        limite: i64,
    ) -> Result<Vec<EnvioDistribuicao>, DomainError>;

    // -- revisões ---------------------------------------------------------
    /// Dedup por (idintegracao, revision_id): `true` = inserida nova.
    /// O payload completo é gravado na inserção — PII some após o ACK.
    async fn revisao_inserir(
        &self,
        idintegracao: i64,
        rev: &RevisaoRemota,
    ) -> Result<bool, DomainError>;
    async fn revisao_por_id_remoto(
        &self,
        idintegracao: i64,
        revision_id: &str,
    ) -> Result<Option<RevisaoDistribuicao>, DomainError>;
    async fn revisao_listar(
        &self,
        idintegracao: i64,
        limite: i64,
    ) -> Result<Vec<RevisaoDistribuicao>, DomainError>;
    async fn revisao_marcar(
        &self,
        id: i64,
        aplicada: bool,
        erro: Option<&str>,
    ) -> Result<(), DomainError>;
    async fn revisao_marcar_ack(&self, id: i64) -> Result<(), DomainError>;
    /// Última revisão aplicada do booking — comparação de ordem/stale.
    async fn revisao_mais_recente_do_booking(
        &self,
        idintegracao: i64,
        booking_id: &str,
    ) -> Result<Option<RevisaoDistribuicao>, DomainError>;

    // -- vínculo reserva ↔ booking ---------------------------------------
    async fn reserva_vinculo(
        &self,
        idintegracao: i64,
        booking_id: &str,
    ) -> Result<Vec<ReservaDistribuicao>, DomainError>;
    async fn reserva_vincular(
        &self,
        idintegracao: i64,
        idreserva: i64,
        booking_id: &str,
        ota_name: Option<&str>,
        ota_reservation_code: Option<&str>,
        dados: &serde_json::Value,
    ) -> Result<(), DomainError>;

    // -- pendências --------------------------------------------------------
    async fn pendencia(
        &self,
        idintegracao: i64,
        tipo: &str,
        descricao: &str,
        revision_id: Option<&str>,
        dados: &serde_json::Value,
    ) -> Result<(), DomainError>;
    async fn pendencias(
        &self,
        idintegracao: i64,
        abertas: bool,
    ) -> Result<Vec<PendenciaDistribuicao>, DomainError>;
    async fn pendencia_resolver(&self, id: i64) -> Result<(), DomainError>;

    // -- resumo -------------------------------------------------------------
    async fn resumo(&self, idintegracao: i64) -> Result<ResumoDistribuicao, DomainError>;

    /// Dias ocupados de uma acomodação na janela — reservas 'p'/'i'
    /// (`periodo` = noites [entrada,saida)) + bloqueios. O worker
    /// transforma isso em `availability` 0/1 por dia.
    async fn ocupacao_dias(
        &self,
        idacomodacao: i64,
        inicio: NaiveDate,
        fim: NaiveDate,
    ) -> Result<Vec<NaiveDate>, DomainError>;
}
