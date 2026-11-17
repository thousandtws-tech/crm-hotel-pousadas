use crate::entities::{AmbienteIntegracao, Integracao, ProvedorIntegracao, StatusVerificacao};
use crate::error::DomainError;
use crate::ports::PaymentGateway;
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use uuid::Uuid;

pub const ESCOPO_PAGAMENTOS_SITE: &str = "pagamentos_site";

#[derive(Debug, Clone)]
pub struct NovoSegredo {
    pub campo: String,
    pub valor_claro: String,
}

#[derive(Debug, Clone, Default)]
pub struct AtualizacaoIntegracao {
    pub segredos: Option<HashMap<String, String>>,
    pub nome_conta: Option<String>,
    pub webhook_url: Option<String>,
    /// Config não-secreta (Z-API: `instance_id`) — merge por chave.
    pub config: Option<serde_json::Value>,
}

#[derive(Debug, Clone)]
pub struct NovaIntegracao {
    pub provedor: ProvedorIntegracao,
    pub ambiente: AmbienteIntegracao,
    pub criado_por: Option<i64>,
}

#[derive(Debug, Clone, Default)]
pub struct MapaSegredos {
    pub campos: HashMap<String, bool>,
}

#[async_trait]
pub trait IntegracaoRepository: Send + Sync {
    async fn listar(&self) -> Result<Vec<Integracao>, DomainError>;

    async fn buscar(
        &self,
        provedor: ProvedorIntegracao,
        ambiente: AmbienteIntegracao,
    ) -> Result<Option<Integracao>, DomainError>;

    async fn buscar_por_id(&self, id: i64) -> Result<Option<Integracao>, DomainError>;

    async fn garantir(&self, nova: &NovaIntegracao) -> Result<Integracao, DomainError>;

    async fn salvar(
        &self,
        id: i64,
        versao_esperada: i32,
        atual: &AtualizacaoIntegracao,
        segredos_enc: &HashMap<String, Vec<u8>>,
        atualizado_por: Option<i64>,
    ) -> Result<Integracao, DomainError>;

    async fn definir_habilitado(
        &self,
        id: i64,
        habilitado: bool,
        atualizado_por: Option<i64>,
    ) -> Result<Integracao, DomainError>;

    async fn registrar_verificacao(
        &self,
        id: i64,
        versao: i32,
        status: StatusVerificacao,
        erro: Option<&str>,
        nome_conta: Option<&str>,
        capabilities: &serde_json::Value,
    ) -> Result<(), DomainError>;

    async fn segredos_enc(
        &self,
        idintegracao: i64,
    ) -> Result<HashMap<String, Vec<u8>>, DomainError>;

    async fn mapa_segredos(&self, idintegracao: i64) -> Result<MapaSegredos, DomainError>;

    async fn remover(&self, id: i64) -> Result<(), DomainError>;

    async fn padrao(
        &self,
        escopo: &str,
    ) -> Result<Option<(ProvedorIntegracao, AmbienteIntegracao, i64)>, DomainError>;

    async fn definir_padrao(
        &self,
        escopo: &str,
        idintegracao: i64,
        atualizado_por: Option<i64>,
    ) -> Result<(), DomainError>;

    async fn limpar_padrao_se(&self, idintegracao: i64) -> Result<(), DomainError>;

    /// Merge de chaves na `config` (sessão Z-API: número, conexão) —
    /// webhooks atualizam sem passar pelo fluxo de salvar credenciais.
    async fn mesclar_config(&self, id: i64, patch: &serde_json::Value) -> Result<(), DomainError>;
}

pub trait CredentialVault: Send + Sync {
    fn selar(&self, contexto: &str, claro: &str) -> Result<Vec<u8>, DomainError>;
    fn abrir(&self, contexto: &str, envelope: &[u8]) -> Result<String, DomainError>;
}

pub enum ResolucaoGateway {
    Persistida(Arc<dyn PaymentGateway>),
    Ambiente(Arc<dyn PaymentGateway>),
    Indisponivel,
}

#[async_trait]
pub trait GatewayResolver: Send + Sync {
    async fn resolver(
        &self,
        provedor: ProvedorIntegracao,
        ambiente: AmbienteIntegracao,
    ) -> Result<ResolucaoGateway, DomainError>;

    async fn resolver_historico(
        &self,
        provedor: ProvedorIntegracao,
        ambiente: AmbienteIntegracao,
    ) -> Result<ResolucaoGateway, DomainError>;

    async fn segredo(&self, idintegracao: i64, campo: &str) -> Result<Option<String>, DomainError>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EstadoEfetivo {
    Ativa,
    Pendente,
    Falha,
    Desativada,
    GerenciadoPeloAmbiente,
    NaoConfigurada,
}

#[derive(Debug, Clone, Serialize)]
pub struct IntegracaoView {
    pub provedor: ProvedorIntegracao,
    pub ambiente: AmbienteIntegracao,
    pub categoria: String,
    pub estado: EstadoEfetivo,
    pub habilitado: bool,
    pub nome_conta: Option<String>,
    pub capabilities: serde_json::Value,
    /// Config não-secreta (Z-API: instance_id, sessão) — segura p/ UI.
    pub config: serde_json::Value,
    pub webhook_url: Option<String>,
    pub segredos: MapaSegredosView,
    pub ultima_verificacao_em: Option<DateTime<Utc>>,
    pub verificacao_status: Option<String>,
    pub verificacao_erro: Option<String>,
    pub versao: i32,
    pub padrao_site: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct MapaSegredosView {
    pub campos: HashMap<String, bool>,
}

impl From<MapaSegredos> for MapaSegredosView {
    fn from(m: MapaSegredos) -> Self {
        Self { campos: m.campos }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct EventoIntegracaoView {
    pub event_id: String,
    pub event_type: String,
    pub status: String,
    pub ultimo_erro: Option<String>,
    pub recebido_em: DateTime<Utc>,
    pub processado_em: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Copy)]
pub struct IdentidadePagamento {
    pub provedor: ProvedorIntegracao,
    pub ambiente: Option<AmbienteIntegracao>,
    pub idintegracao: Option<i64>,
}

impl IdentidadePagamento {
    pub fn legado() -> Self {
        Self {
            provedor: ProvedorIntegracao::Stripe,
            ambiente: None,
            idintegracao: None,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct VersaoEsperada(pub i32);

impl From<i32> for VersaoEsperada {
    fn from(v: i32) -> Self {
        Self(v)
    }
}

#[allow(dead_code)]
fn _unused(_: Uuid) {}
