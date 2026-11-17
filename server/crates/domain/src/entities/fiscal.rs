//! Documento fiscal emitido via provedor externo (Spedy — NFS-e hoje).
//!
//! O status local é um mapeamento explícito do `status_remoto` do
//! provedor — nunca confundir `processingDetail` com autorização, e
//! valores desconhecidos são preservados em `status_remoto` para
//! diagnóstico sem serem tratados como sucesso.

use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::Serialize;
use sqlx::FromRow;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StatusFiscal {
    /// Criado localmente, aguardando confirmação do operador.
    Rascunho,
    /// Confirmado — intenção durável, worker ainda não transmitiu.
    Enfileirada,
    /// Aceito pelo provedor, aguardando decisão da autoridade.
    Processando,
    Autorizada,
    Rejeitada,
    CancelamentoSolicitado,
    Cancelada,
    /// Falha técnica/transitória (rede, 5xx) — elegível a retry.
    Falha,
}

impl StatusFiscal {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Rascunho => "rascunho",
            Self::Enfileirada => "enfileirada",
            Self::Processando => "processando",
            Self::Autorizada => "autorizada",
            Self::Rejeitada => "rejeitada",
            Self::CancelamentoSolicitado => "cancelamento_solicitado",
            Self::Cancelada => "cancelada",
            Self::Falha => "falha",
        }
    }

    /// Mapeamento explícito do status remoto da Spedy para o status
    /// interno. Valores desconhecidos devolvem `None` — o chamador
    /// preserva o cru em `status_remoto` e decide o diagnóstico, sem
    /// nunca convertê-lo em autorização.
    pub fn do_remoto(remoto: &str) -> Option<Self> {
        match remoto {
            "queued" | "processing" | "waiting" | "waitingReturn" => Some(Self::Processando),
            "authorized" => Some(Self::Autorizada),
            "denied" | "rejected" | "error" => Some(Self::Rejeitada),
            "cancelRequested" | "cancelling" => Some(Self::CancelamentoSolicitado),
            "cancelled" | "canceled" => Some(Self::Cancelada),
            _ => None,
        }
    }

    /// Transições terminais — não voltam atrás nem aceitam evento antigo.
    pub fn terminal(&self) -> bool {
        matches!(self, Self::Cancelada)
    }

    /// Se o documento pode receber nova transmissão (reprocessar/corrigir).
    pub fn reprocessavel(&self) -> bool {
        matches!(self, Self::Rejeitada | Self::Falha | Self::Rascunho)
    }

    /// Se o cancelamento pode ser solicitado neste estado.
    pub fn cancelavel(&self) -> bool {
        matches!(self, Self::Autorizada)
    }
}

impl From<String> for StatusFiscal {
    fn from(s: String) -> Self {
        match s.as_str() {
            "enfileirada" => Self::Enfileirada,
            "processando" => Self::Processando,
            "autorizada" => Self::Autorizada,
            "rejeitada" => Self::Rejeitada,
            "cancelamento_solicitado" => Self::CancelamentoSolicitado,
            "cancelada" => Self::Cancelada,
            "falha" => Self::Falha,
            _ => Self::Rascunho,
        }
    }
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct FiscalDocumento {
    pub id: i64,
    pub idintegracao: i64,
    pub idreserva: Option<i64>,
    pub modelo: String,
    pub integration_id: String,
    pub remote_id: Option<String>,
    #[sqlx(try_from = "String")]
    #[serde(serialize_with = "ser_status")]
    pub status: StatusFiscal,
    pub status_remoto: Option<String>,
    pub processing_detail: Option<String>,
    pub tomador: serde_json::Value,
    pub payload: serde_json::Value,
    pub valor_total: Decimal,
    pub descricao: Option<String>,
    pub competencia: Option<NaiveDate>,
    pub motivo_cancelamento: Option<String>,
    pub numero_nota: Option<String>,
    pub url_consulta: Option<String>,
    pub ultimo_erro: Option<String>,
    pub tentativas: i32,
    pub proxima_tentativa: Option<DateTime<Utc>>,
    pub criado_por: Option<i64>,
    pub atualizado_por: Option<i64>,
    pub transmitido_em: Option<DateTime<Utc>>,
    pub autorizado_em: Option<DateTime<Utc>>,
    pub cancelado_em: Option<DateTime<Utc>>,
    pub criado_em: DateTime<Utc>,
    pub atualizado_em: DateTime<Utc>,
}

#[allow(clippy::trivially_copy_pass_by_ref)]
fn ser_status<S: serde::Serializer>(st: &StatusFiscal, s: S) -> Result<S::Ok, S::Error> {
    s.serialize_str(st.as_str())
}

#[derive(Debug, Clone, FromRow)]
pub struct FiscalEvento {
    pub id: i64,
    pub idintegracao: Option<i64>,
    pub event_id: String,
    pub tipo: String,
    pub payload: serde_json::Value,
    pub assinatura_ok: bool,
    pub status: String,
    pub ultimo_erro: Option<String>,
    pub recebido_em: DateTime<Utc>,
    pub processado_em: Option<DateTime<Utc>>,
}

/// Gera o `integrationId` estável por documento — reaproveitado em
/// todas as retentativas para idempotência no provedor (≤36 chars).
pub fn integration_id(modelo: &str, idreserva: Option<i64>, sequencia: i64) -> String {
    match idreserva {
        Some(r) => format!("{modelo}-res{r}-v{sequencia}"),
        None => format!("{modelo}-avulsa-v{sequencia}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mapeia_status_remoto() {
        assert_eq!(
            StatusFiscal::do_remoto("authorized"),
            Some(StatusFiscal::Autorizada)
        );
        assert_eq!(
            StatusFiscal::do_remoto("processing"),
            Some(StatusFiscal::Processando)
        );
        assert_eq!(
            StatusFiscal::do_remoto("rejected"),
            Some(StatusFiscal::Rejeitada)
        );
        assert_eq!(
            StatusFiscal::do_remoto("cancelled"),
            Some(StatusFiscal::Cancelada)
        );
        assert_eq!(
            StatusFiscal::do_remoto("cancelRequested"),
            Some(StatusFiscal::CancelamentoSolicitado)
        );
        assert_eq!(StatusFiscal::do_remoto("desconhecido"), None);
        assert_eq!(StatusFiscal::do_remoto(""), None);
    }

    #[test]
    fn cancelada_e_terminal() {
        assert!(StatusFiscal::Cancelada.terminal());
        assert!(!StatusFiscal::Autorizada.terminal());
        assert!(StatusFiscal::Autorizada.cancelavel());
        assert!(!StatusFiscal::Processando.cancelavel());
    }

    #[test]
    fn integration_id_estavel_e_curto() {
        let id = integration_id("nfse", Some(42), 3);
        assert_eq!(id, "nfse-res42-v3");
        assert!(id.len() <= 36);
    }
}
