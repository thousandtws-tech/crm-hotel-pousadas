//! Formas de pagamento aceitas no fechamento da conta.

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

// ---------------------------------------------------------------------------
// Pagamentos online (Stripe) — obrigação, tentativa, reembolso, webhook.
// Valores em centavos (i64) — nunca float; moeda sempre 'brl' hoje.
// ---------------------------------------------------------------------------

use crate::enums::{StatusPagamento, StatusProcWebhook, StatusReembolso, TipoPagamento};
use serde_json::Value as JsonValue;

/// Obrigação financeira da reserva cobrada via Stripe.
/// Uma reserva pode ter N pagamentos (ex.: sinal + saldo).
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct PagamentoOnline {
    pub id: i64,
    pub idreserva: i64,
    pub tipo: TipoPagamento,
    pub status: StatusPagamento,
    /// Valor cobrado, em centavos de BRL.
    pub valor_centavos: i64,
    pub moeda: String,
    /// Stripe payment_intent (pi_...) — preenchido quando o provedor o cria.
    pub pi_id: Option<String>,
    /// 'card' | 'pix' — informado pelo webhook de confirmação.
    pub metodo: Option<String>,
    pub paid_em: Option<DateTime<Utc>>,
    pub criado_em: DateTime<Utc>,
    pub atualizado_em: DateTime<Utc>,
}

impl PagamentoOnline {
    /// R$ formatado a partir dos centavos (apresentação/relatórios).
    pub fn valor_reais(&self) -> f64 {
        self.valor_centavos as f64 / 100.0
    }
}

/// Uma sessão Stripe Checkout ligada ao pagamento — idempotente por session_id.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct TentativaPagamento {
    pub id: i64,
    pub idpagamento: i64,
    pub session_id: String,
    /// URL hospedada do checkout — permite reuso idempotente da sessão.
    pub session_url: Option<String>,
    /// 'aberta' | 'expirada' | 'paga' — texto simples (vem do provedor).
    pub status: String,
    pub expires_em: DateTime<Utc>,
    pub criado_em: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct ReembolsoPagamento {
    pub id: i64,
    pub idpagamento: i64,
    /// Stripe refund (re_...) — NULL até o provedor confirmar a criação.
    pub refund_id: Option<String>,
    pub valor_centavos: i64,
    pub motivo: Option<String>,
    pub status: StatusReembolso,
    pub criado_em: DateTime<Utc>,
    pub atualizado_em: DateTime<Utc>,
}

/// Evento recebido no endpoint de webhook — inbox com idempotência.
#[derive(Debug, Clone, FromRow)]
pub struct WebhookEvento {
    pub id: i64,
    pub event_id: String,
    pub event_type: String,
    pub payload: JsonValue,
    pub status: StatusProcWebhook,
    pub tentativas: i32,
    pub ultimo_erro: Option<String>,
    pub recebido_em: DateTime<Utc>,
    pub processado_em: Option<DateTime<Utc>>,
}

/// Linha imutável da trilha de auditoria do pagamento.
#[derive(Debug, Clone)]
pub struct NovaAuditoriaPagamento {
    pub idpagamento: i64,
    /// 'stripe' | 'funcionario' | 'sistema'
    pub ator_tipo: &'static str,
    pub ator_id: Option<i64>,
    pub acao: &'static str,
    pub dados: Option<JsonValue>,
}
