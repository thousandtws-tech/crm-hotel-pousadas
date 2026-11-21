use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "pagamento_tipo", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum TipoPagamento {
    Integral,
    Sinal,
    Saldo,
    /// Extra vendido pelo portal (early/late check-in-out, upgrade) —
    /// cobrança avulsa que não amortiza o valor da estadia.
    Extra,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "pagamento_status", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum StatusPagamento {
    Pendente,
    Pago,
    Expirado,
    Falhou,
    Cancelado,
    ReembolsoParcial,
    Reembolsado,
}

impl StatusPagamento {
    pub fn cobravel(&self) -> bool {
        matches!(self, Self::Pendente | Self::Falhou | Self::Expirado)
    }

    pub fn liquidado(&self) -> bool {
        matches!(
            self,
            Self::Pago | Self::ReembolsoParcial | Self::Reembolsado
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "webhook_proc_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum StatusProcWebhook {
    Recebido,
    Processado,
    Falhou,
    Ignorado,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "reembolso_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum StatusReembolso {
    Pendente,
    Concluido,
    Falhou,
}
