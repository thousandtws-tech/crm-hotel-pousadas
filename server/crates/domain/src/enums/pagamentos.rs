use serde::{Deserialize, Serialize};

/// Tipo da obrigação cobrada via Stripe (integral, sinal de 30% ou saldo).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "pagamento_tipo", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum TipoPagamento {
    Integral,
    Sinal,
    Saldo,
}

/// Ciclo de vida do pagamento online — dirigido pelos webhooks Stripe e
/// pelo sweeper de expiração. `Pago` é o único estado de liquidação.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "pagamento_status", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum StatusPagamento {
    /// Tentativa(s) em aberto ou aguardando confirmação assíncrona (Pix).
    Pendente,
    Pago,
    /// Todas as tentativas expiraram sem pagamento.
    Expirado,
    Falhou,
    Cancelado,
    ReembolsoParcial,
    Reembolsado,
}

impl StatusPagamento {
    /// Pode receber uma nova tentativa de checkout.
    pub fn cobravel(&self) -> bool {
        matches!(self, Self::Pendente | Self::Falhou | Self::Expirado)
    }

    /// Liquidação confirmada — não volta atrás exceto por reembolso.
    pub fn liquidado(&self) -> bool {
        matches!(
            self,
            Self::Pago | Self::ReembolsoParcial | Self::Reembolsado
        )
    }
}

/// Processamento do evento de webhook na inbox (`pagamento_webhook_evento`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "webhook_proc_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum StatusProcWebhook {
    Recebido,
    Processado,
    Falhou,
    /// Evento válido porém irrelevante para o domínio (ex.: evento desconhecido).
    Ignorado,
}

/// Estado do reembolso Stripe (`pagamento_reembolso`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "reembolso_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum StatusReembolso {
    Pendente,
    Concluido,
    Falhou,
}
