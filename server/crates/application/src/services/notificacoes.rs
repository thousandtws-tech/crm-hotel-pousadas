//! Inbox de notificações — leitura do histórico persistido pelo persister
//! do EventBus. Avisos são broadcast por nível (`ate_nivel`); o estado de
//! leitura é por funcionário (`notificacao_lida`).

use crate::actor::Ator;
use crate::error::AppResult;
use clarituz_domain::entities::Notificacao;
use clarituz_domain::DomainError;
use clarituz_domain::ports::NotificacaoRepository;
use clarituz_shared::{Page, PageParams};
use std::sync::Arc;

pub struct NotificacaoService {
    repo: Arc<dyn NotificacaoRepository>,
}

impl NotificacaoService {
    pub fn new(repo: Arc<dyn NotificacaoRepository>) -> Self {
        Self { repo }
    }

    /// Inbox do usuário — mais recentes primeiro.
    pub async fn inbox(&self, ator: &Ator, page: PageParams) -> AppResult<Page<Notificacao>> {
        Ok(self.repo.inbox(ator.id, ator.nivel.as_i16(), page).await?)
    }

    /// Badge de não-lidas.
    pub async fn nao_lidas(&self, ator: &Ator) -> AppResult<i64> {
        Ok(self.repo.nao_lidas(ator.id, ator.nivel.as_i16()).await?)
    }

    pub async fn marcar_lida(&self, ator: &Ator, id: i64) -> AppResult<()> {
        Ok(self.repo.marcar_lida(id, ator.id).await?)
    }

    /// "Marcar todas como lidas" — retorna quantas foram marcadas.
    pub async fn marcar_todas(&self, ator: &Ator) -> AppResult<u64> {
        Ok(self.repo.marcar_todas(ator.id, ator.nivel.as_i16()).await?)
    }

    /// Exclui uma notificação do histórico — restrito a admin, já que a
    /// linha é compartilhada (broadcast por nível) e o histórico é de todos.
    pub async fn excluir(&self, ator: &Ator, id: i64) -> AppResult<()> {
        ator.exigir_admin()?;
        if !self.repo.excluir(id).await? {
            return Err(DomainError::NaoEncontrado("Notificação não encontrada".into()).into());
        }
        Ok(())
    }
}
