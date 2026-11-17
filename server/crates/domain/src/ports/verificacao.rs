//! Ports do contexto de verificação de identidade: provedor KYC e
//! persistência de sessões/eventos.

use crate::entities::{VerificacaoIdentidade, VerificacaoListItem};
use crate::error::DomainError;
use async_trait::async_trait;
use clarituz_shared::{Page, PageParams};
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct SessaoVerificacao {
    pub session_id: String,
    pub url: String,
}

/// Visão remota da decisão — `status` é a string exata do provedor;
/// `resumo` guarda a decisão completa para auditoria.
#[derive(Debug, Clone)]
pub struct DecisaoRemota {
    pub status: String,
    pub resumo: serde_json::Value,
}

#[derive(Debug, Clone)]
pub struct DestinoWebhook {
    pub id: String,
    pub secret_shared_key: String,
}

/// Cliente do provedor de verificação (Didit v3). `testar` é a chamada
/// read-only usada no "Testar conexão" do card de integração.
#[async_trait]
pub trait ProvedorVerificacao: Send + Sync {
    async fn testar(&self) -> Result<String, DomainError>;
    async fn criar_sessao(
        &self,
        workflow_id: &str,
        vendor_data: &str,
        callback: Option<&str>,
    ) -> Result<SessaoVerificacao, DomainError>;
    async fn decisao(&self, session_id: &str) -> Result<DecisaoRemota, DomainError>;
    async fn registrar_destino(&self, url: &str) -> Result<DestinoWebhook, DomainError>;
}

#[derive(Debug, Clone)]
pub struct NovaVerificacao {
    pub integracao_id: i64,
    pub funcionario_id: i64,
    pub session_id: String,
    pub url: String,
    pub vendor_data: String,
}

#[async_trait]
pub trait VerificacaoRepository: Send + Sync {
    async fn criar(&self, nova: &NovaVerificacao) -> Result<VerificacaoIdentidade, DomainError>;
    async fn por_id(&self, id: Uuid) -> Result<Option<VerificacaoIdentidade>, DomainError>;
    async fn por_session(
        &self,
        session_id: &str,
    ) -> Result<Option<VerificacaoIdentidade>, DomainError>;
    /// Sessão viva (não terminal) do funcionário na integração — se
    /// existir, o link é reutilizado em vez de abrir sessão nova.
    async fn viva(
        &self,
        funcionario_id: i64,
        integracao_id: i64,
    ) -> Result<Option<VerificacaoIdentidade>, DomainError>;
    /// Última verificação do funcionário (qualquer status).
    async fn atual(
        &self,
        funcionario_id: i64,
        integracao_id: i64,
    ) -> Result<Option<VerificacaoIdentidade>, DomainError>;
    async fn listar(
        &self,
        page: PageParams,
        integracao_id: i64,
    ) -> Result<Page<VerificacaoListItem>, DomainError>;
    async fn atualizar_status(
        &self,
        id: Uuid,
        status: &str,
        status_remoto: Option<&str>,
        resumo: &serde_json::Value,
        decidido: bool,
    ) -> Result<(), DomainError>;
    /// Inbox — `true` quando o evento é novo (dedup por `event_id`).
    async fn inbox_inserir(
        &self,
        event_id: &str,
        session_id: Option<&str>,
        webhook_type: Option<&str>,
        payload: &serde_json::Value,
    ) -> Result<bool, DomainError>;
    async fn inbox_marcar_processado(&self, event_id: &str) -> Result<(), DomainError>;
}
