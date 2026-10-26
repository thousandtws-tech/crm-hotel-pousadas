//! Porta do motor realtime — services publicam avisos sem conhecer o
//! transporte (broadcast in-process, relay PG, SSE…).

use crate::entities::busca::ItemBusca;
use crate::entities::notificacao::Notificacao;
use crate::events::Aviso;
use crate::DomainError;
use async_trait::async_trait;
use clarituz_shared::{Page, PageParams};

/// Publica avisos de domínio para os clientes conectados.
/// Implementação padrão: `EventBus` (tokio broadcast) em `infrastructure`.
pub trait EventoPublisher: Send + Sync {
    fn avisar(&self, aviso: Aviso);
}

/// Persistência + inbox do histórico de notificações.
///
/// Visibilidade: `n.ate_nivel >= nivel_do_ator` (1=admin vê tudo,
/// 3=recepção só vê avisos `ate_nivel = 3`).
#[async_trait]
pub trait NotificacaoRepository: Send + Sync {
    /// Persiste um aviso do barramento (chamado pelo persister).
    async fn registrar(&self, aviso: &Aviso) -> Result<i64, DomainError>;

    /// Inbox paginado do usuário — mais recentes primeiro, com `lida`.
    async fn inbox(
        &self,
        idfuncionario: i64,
        nivel: i16,
        page: PageParams,
    ) -> Result<Page<Notificacao>, DomainError>;

    /// Contador do badge — COUNT sem recibo.
    async fn nao_lidas(&self, idfuncionario: i64, nivel: i16) -> Result<i64, DomainError>;

    /// Read receipt de uma notificação (idempotente).
    async fn marcar_lida(&self, idnotificacao: i64, idfuncionario: i64) -> Result<(), DomainError>;

    /// Marca todas as visíveis como lidas. Retorna quantas foram marcadas.
    async fn marcar_todas(&self, idfuncionario: i64, nivel: i16) -> Result<u64, DomainError>;

    /// Remove a notificação do histórico (CASCADE apaga os read receipts).
    async fn excluir(&self, id: i64) -> Result<bool, DomainError>;
}

/// Busca global do header — varre as principais entidades visíveis ao nível
/// do ator e devolve hits agrupáveis por `tipo` com deep-link (`rota`).
#[async_trait]
pub trait BuscaRepository: Send + Sync {
    async fn buscar(
        &self,
        termo: &str,
        admin: bool,
        limite: i64,
    ) -> Result<Vec<ItemBusca>, DomainError>;
}
