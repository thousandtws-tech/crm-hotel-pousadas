use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::FromRow;

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct FormaPagamento {
    pub id: i64,
    pub nome: String,
    pub ativo: bool,
    pub version: i64,
    pub criado_em: DateTime<Utc>,
}

use crate::enums::{StatusPagamento, StatusProcWebhook, StatusReembolso, TipoPagamento};
use serde_json::Value as JsonValue;

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct PagamentoOnline {
    pub id: i64,
    pub idreserva: i64,
    pub tipo: TipoPagamento,
    pub status: StatusPagamento,
    pub valor_centavos: i64,
    pub moeda: String,
    pub pi_id: Option<String>,
    pub metodo: Option<String>,
    pub paid_em: Option<DateTime<Utc>>,
    pub provedor: String,
    pub ambiente: Option<String>,
    pub idintegracao: Option<i64>,
    pub criado_em: DateTime<Utc>,
    pub atualizado_em: DateTime<Utc>,
}

impl PagamentoOnline {
    pub fn valor_reais(&self) -> f64 {
        self.valor_centavos as f64 / 100.0
    }
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct TentativaPagamento {
    pub id: i64,
    pub idpagamento: i64,
    pub session_id: String,
    pub session_url: Option<String>,
    pub status: String,
    pub expires_em: DateTime<Utc>,
    pub criado_em: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct ReembolsoPagamento {
    pub id: i64,
    pub idpagamento: i64,
    pub refund_id: Option<String>,
    pub valor_centavos: i64,
    pub motivo: Option<String>,
    pub status: StatusReembolso,
    pub criado_em: DateTime<Utc>,
    pub atualizado_em: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct WebhookEvento {
    pub id: i64,
    pub provedor: String,
    pub event_id: String,
    pub event_type: String,
    pub payload: JsonValue,
    pub idintegracao: Option<i64>,
    pub status: StatusProcWebhook,
    pub tentativas: i32,
    pub ultimo_erro: Option<String>,
    pub recebido_em: DateTime<Utc>,
    pub processado_em: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone)]
pub struct NovaAuditoriaPagamento {
    pub idpagamento: i64,
    pub ator_tipo: &'static str,
    pub ator_id: Option<i64>,
    pub acao: &'static str,
    pub dados: Option<JsonValue>,
}
