//! Casos de uso de auditoria — leitura da trilha (admin only).

use crate::actor::Ator;
use crate::error::AppResult;
use clarituz_domain::entities::{NovoLog, RegistroLog};
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
        // Decreto 8.771/16, art. 13, III — inventário de acessos aos
        // registros: quem consultou a trilha, quando e com qual filtro.
        // Se a trilha não puder registrar o próprio acesso, o acesso
        // aos registros é negado.
        self.repo
            .inserir(NovoLog {
                idfuncionario: Some(ator.id),
                acao: "auditoria:consulta".into(),
                obs: format!("{} consultou a trilha de auditoria.", ator.nome),
                tabela: "log",
                idtabela: 0,
                dados: Some(serde_json::json!({
                    "tabela": filtro.tabela.as_deref(),
                    "acao": filtro.acao.as_deref(),
                    "idfuncionario": filtro.idfuncionario,
                    "idtabela": filtro.idtabela,
                    "desde": filtro.desde,
                    "ate": filtro.ate,
                })),
            })
            .await?;
        self.repo.listar(&filtro, page).await.map_err(Into::into)
    }
}
