//! Casos de uso de auditoria — leitura da trilha (admin only).

use crate::actor::Ator;
use crate::error::AppResult;
use clarituz_domain::entities::RegistroLog;
use clarituz_domain::ports::{FiltroLog, LogRepository};
use clarituz_shared::{Page, PageParams};
use std::sync::Arc;

pub struct AuditoriaService {
    repo: Arc<dyn LogRepository>,
}

impl AuditoriaService {
    pub fn new(repo: Arc<dyn LogRepository>) -> Self {
        Self { repo }
    }

    pub async fn listar(
        &self,
        ator: &Ator,
        filtro: FiltroLog,
        page: PageParams,
    ) -> AppResult<Page<RegistroLog>> {
        ator.exigir_admin()?;
        self.repo.listar(&filtro, page).await.map_err(Into::into)
    }
}
