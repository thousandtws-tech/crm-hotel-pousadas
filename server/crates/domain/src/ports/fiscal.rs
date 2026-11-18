//! Porta de domínio para o provedor fiscal (Spedy) e repositório de
//! documentos fiscais. A aplicação orquestra emissão/cancelamento; a
//! infraestrutura traduz as chamadas HTTP e o webhook assinado.

use async_trait::async_trait;
use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

use crate::entities::{AmbienteIntegracao, FiscalDocumento, FiscalEvento, StatusFiscal};
use crate::error::DomainError;

/// Entrada para criar o rascunho durável — confirmação explícita do
/// operador já aconteceu na camada HTTP antes daqui.
pub struct NovoDocumentoFiscal {
    pub idintegracao: i64,
    pub idreserva: Option<i64>,
    pub modelo: String,
    pub integration_id: String,
    pub tomador: serde_json::Value,
    pub payload: serde_json::Value,
    pub valor_total: Decimal,
    pub descricao: Option<String>,
    pub competencia: Option<NaiveDate>,
    pub criado_por: Option<i64>,
}

#[derive(Debug, Clone, Default)]
pub struct FiltroDocumentos {
    pub idreserva: Option<i64>,
    pub status: Option<StatusFiscal>,
    pub de: Option<NaiveDate>,
    pub ate: Option<NaiveDate>,
    pub ambiente: Option<AmbienteIntegracao>,
    pub pagina: i64,
    pub por_pagina: i64,
}

#[async_trait]
pub trait FiscalRepository: Send + Sync {
    async fn criar(&self, novo: &NovoDocumentoFiscal) -> Result<FiscalDocumento, DomainError>;
    async fn buscar(&self, id: i64) -> Result<Option<FiscalDocumento>, DomainError>;
    async fn buscar_por_integration_id(
        &self,
        idintegracao: i64,
        integration_id: &str,
    ) -> Result<Option<FiscalDocumento>, DomainError>;
    async fn buscar_por_remote_id(
        &self,
        remote_id: &str,
    ) -> Result<Option<FiscalDocumento>, DomainError>;
    async fn listar(
        &self,
        filtro: &FiltroDocumentos,
    ) -> Result<(Vec<FiscalDocumento>, i64), DomainError>;
    async fn listar_por_reserva(&self, idreserva: i64)
        -> Result<Vec<FiscalDocumento>, DomainError>;
    /// Sequência do próximo documento da integração — compõe o
    /// `integration_id` determinístico.
    async fn proxima_sequencia(&self, idintegracao: i64) -> Result<i64, DomainError>;
    /// Transição durável + atualização do snapshot remoto.
    #[allow(clippy::too_many_arguments)]
    async fn registrar_transicao(
        &self,
        id: i64,
        status: StatusFiscal,
        status_remoto: Option<&str>,
        processing_detail: Option<&str>,
        remote_id: Option<&str>,
        numero_nota: Option<&str>,
        url_consulta: Option<&str>,
        erro: Option<&str>,
        atualizado_por: Option<i64>,
    ) -> Result<(), DomainError>;
    /// Reivindica documentos prontos para transmissão (SKIP LOCKED) —
    /// seguro para múltiplos workers/réplicas.
    async fn reivindicar_fila(&self, limite: i64) -> Result<Vec<FiscalDocumento>, DomainError>;
    /// Justificativa do cancelamento — trilha separada do status.
    async fn registrar_motivo_cancelamento(&self, id: i64, motivo: &str)
        -> Result<(), DomainError>;
    /// Documentos em estado de falha ('rejeitada' | 'falha') com
    /// atualização recente — varredura do monitor de alertas.
    async fn falhas(
        &self,
        desde: chrono::DateTime<chrono::Utc>,
        limite: i64,
    ) -> Result<Vec<FiscalDocumento>, DomainError>;
    /// Reagenda com backoff (o erro já vai em `ultimo_erro`).
    async fn reagendar(
        &self,
        id: i64,
        tentativas: i32,
        proxima: chrono::DateTime<chrono::Utc>,
        erro: &str,
    ) -> Result<(), DomainError>;

    async fn registrar_evento(
        &self,
        idintegracao: Option<i64>,
        event_id: &str,
        tipo: &str,
        payload: &serde_json::Value,
        assinatura_ok: bool,
    ) -> Result<FiscalEventoRegistro, DomainError>;
    async fn marcar_evento(
        &self,
        id: i64,
        status: &str,
        erro: Option<&str>,
    ) -> Result<(), DomainError>;
    async fn ultimo_evento(&self, idintegracao: i64) -> Result<Option<FiscalEvento>, DomainError>;
}

/// 'inserido' = novo; 'duplicado' = já conhecido (2xx sem repetir efeitos).
pub enum FiscalEventoRegistro {
    Inserido(i64),
    Duplicado,
}

// ---------------------------------------------------------------------------
// Porta do provedor — tradução 1:1 das operações do contrato Spedy.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotaRemota {
    pub id: String,
    pub status: String,
    pub processing_detail: Option<String>,
    pub number: Option<String>,
    /// URL de consulta pública da nota, quando o provedor a informa.
    pub url: Option<String>,
}

#[derive(Debug, Clone)]
pub struct EmpresaRemota {
    pub id: String,
    pub cnpj: Option<String>,
    pub razao_social: Option<String>,
}

#[async_trait]
pub trait ProvedorFiscal: Send + Sync {
    /// Consulta leve para teste de conexão — nunca emite nem altera.
    async fn empresa(&self) -> Result<EmpresaRemota, DomainError>;

    /// Cria e enfileira a NFS-e — 2xx = aceita, NÃO autorizada.
    async fn emitir(
        &self,
        integration_id: &str,
        payload: &serde_json::Value,
    ) -> Result<NotaRemota, DomainError>;

    async fn consultar(&self, remote_id: &str) -> Result<NotaRemota, DomainError>;

    /// Reconciliação com a autoridade — não acelera fila.
    async fn reconciliar(&self, remote_id: &str) -> Result<NotaRemota, DomainError>;

    /// Reprocessa a emissão de uma nota existente (payload novo exige
    /// revisão e nova auditoria — o service controla isso).
    async fn reprocessar(&self, remote_id: &str) -> Result<NotaRemota, DomainError>;

    async fn cancelar(&self, remote_id: &str, motivo: &str) -> Result<NotaRemota, DomainError>;

    /// Binário oficial (PDF ou XML) do documento autorizado.
    async fn arquivo(&self, remote_id: &str, tipo: &str) -> Result<Vec<u8>, DomainError>;

    /// Segredo da conta para verificação de assinatura Standard Webhooks.
    async fn segredo_webhook(&self) -> Result<String, DomainError>;

    /// Configurações de emissão do município (IBGE) — provedores,
    /// regimes e campos exigidos; 404 = município não atendido.
    async fn municipio_settings(&self, ibge: &str) -> Result<serde_json::Value, DomainError>;

    /// Configurações remotas da empresa (ambiente fiscal, numeração).
    async fn empresa_settings(&self) -> Result<serde_json::Value, DomainError>;

    /// Registra/atualiza o webhook do evento `invoice.status_changed`.
    async fn configurar_webhook(&self, url: &str) -> Result<serde_json::Value, DomainError>;
}
