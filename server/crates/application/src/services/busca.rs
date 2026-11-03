//! Busca global do header — padrão Salesforce/HubSpot: um endpoint
//! agregador que varre as entidades navegáveis e devolve hits com
//! `rota` de deep-link. Funcionários só entram no resultado de admin.

use crate::actor::Ator;
use crate::error::AppResult;
use clarituz_domain::entities::ItemBusca;
use clarituz_domain::ports::BuscaRepository;
use std::sync::Arc;

const LIMITE_POR_TIPO: i64 = 5;

pub struct BuscaService {
    repo: Arc<dyn BuscaRepository>,
}

impl BuscaService {
    pub fn new(repo: Arc<dyn BuscaRepository>) -> Self {
        Self { repo }
    }

    /// Termos com menos de 2 chars retornam vazio — evita table scan caro
    /// a cada tecla e espelha o mínimo dos CRMs grandes.
    pub async fn buscar(&self, ator: &Ator, termo: &str) -> AppResult<Vec<ItemBusca>> {
        let t = termo.trim();
        if t.len() < 2 {
            return Ok(vec![]);
        }
        Ok(self
            .repo
            .buscar(t, ator.is_admin(), LIMITE_POR_TIPO)
            .await?)
    }
}
