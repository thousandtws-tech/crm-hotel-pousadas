//! Entidades da distribuição por canais (Channex → OTAs).
//!
//! O CRM publica disponibilidade/tarifas (ARI) e recebe revisões de
//! reserva. Toda linha carrega `idintegracao` — provedor+ambiente+escopo
//! nunca se misturam.

use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use sqlx::FromRow;

/// Mapeamento versionado acomodação → room type + rate plan remotos.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct MapaDistribuicao {
    pub id: i64,
    pub idintegracao: i64,
    pub idacomodacao: i64,
    pub room_type_id: String,
    pub rate_plan_id: String,
    pub ativo: bool,
    pub versao: i32,
    pub criado_em: DateTime<Utc>,
    pub atualizado_em: DateTime<Utc>,
}

/// Revisão de booking recebida — payload completo gravado antes do ACK
/// (a Channex remove PII após o ACK; sem payload persistido não há
/// como auditar ou reprocessar).
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct RevisaoDistribuicao {
    pub id: i64,
    pub idintegracao: i64,
    pub revision_id: String,
    pub booking_id: Option<String>,
    pub unique_id: Option<String>,
    pub ota_name: Option<String>,
    pub ota_reservation_code: Option<String>,
    /// `new` | `modified` | `cancelled` — cru do provedor.
    pub status: String,
    pub property_id: String,
    pub payload: serde_json::Value,
    pub ack: bool,
    pub ack_em: Option<DateTime<Utc>>,
    pub aplicada: bool,
    pub erro: Option<String>,
    pub inserted_at: Option<DateTime<Utc>>,
    pub recebido_em: DateTime<Utc>,
}

/// Vínculo estável reserva local ↔ booking OTA.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct ReservaDistribuicao {
    pub id: i64,
    pub idintegracao: i64,
    pub idreserva: i64,
    pub booking_id: String,
    pub ota_name: Option<String>,
    pub ota_reservation_code: Option<String>,
    /// Verdade da OTA: `days` (preço/noite), `currency`, `payment_collect`,
    /// `payment_type`, `occupancy` — nunca recalculada pela diária local.
    pub dados: serde_json::Value,
    pub criado_em: DateTime<Utc>,
}

/// Auditoria de envio ARI — task ids + meta.warnings para a
/// certificação e para distinguir aceite de aceite parcial.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct EnvioDistribuicao {
    pub id: i64,
    pub idintegracao: i64,
    /// `availability` | `restrictions`.
    pub tipo: String,
    pub valores: serde_json::Value,
    pub task_ids: serde_json::Value,
    pub warnings: serde_json::Value,
    pub criado_em: DateTime<Utc>,
}

/// Pendência operacional — nada cai no silêncio: reserva OTA sem
/// mapeamento, conflito de inventário, falha de envio, revisão órfã.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct PendenciaDistribuicao {
    pub id: i64,
    pub idintegracao: i64,
    /// `mapeamento_ausente` | `conflito_inventario` | `revisao_orfa` |
    /// `aplicacao_falhou` | `envio_falhou` | `revisao_obsoleta`.
    pub tipo: String,
    pub descricao: String,
    pub revision_id: Option<String>,
    pub dados: serde_json::Value,
    pub resolvida: bool,
    pub criado_em: DateTime<Utc>,
    pub resolvido_em: Option<DateTime<Utc>>,
}

/// Item de outbox ARI — enfileirado junto da mutação local e drenado
/// pelo worker com o estado atual recalculado (nunca o delta antigo).
#[derive(Debug, Clone)]
pub struct NovoOutboxAri {
    pub idintegracao: i64,
    pub idacomodacao: i64,
    pub inicio: NaiveDate,
    pub fim: NaiveDate,
    pub motivo: String,
}

/// Resumo da visão Distribuição — um painel, uma leitura.
#[derive(Debug, Serialize)]
pub struct ResumoDistribuicao {
    pub mapeadas: i64,
    pub sem_mapeamento: i64,
    pub revisoes_pendentes: i64,
    pub revisoes_sem_ack: i64,
    pub pendencias_abertas: i64,
    pub outbox_pendente: i64,
    pub ultima_revisao_em: Option<DateTime<Utc>>,
    pub ultimo_envio_em: Option<DateTime<Utc>>,
}

/// Linha da grade de mapeamento — acomodação + destino remoto.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct MapaDistribuicaoView {
    pub id: i64,
    pub idacomodacao: i64,
    pub acomodacao: String,
    pub numero: Option<String>,
    pub room_type_id: String,
    pub rate_plan_id: String,
    pub ativo: bool,
    pub atualizado_em: DateTime<Utc>,
}
