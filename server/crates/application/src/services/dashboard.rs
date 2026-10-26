//! Casos de uso do dashboard — equivalente a `home/include/*`.

use crate::dto::{AcomodacaoBasica, DashboardResponse};
use crate::error::AppResult;
use clarituz_domain::ports::DashboardRepository;
use clarituz_shared::time;
use std::sync::Arc;
use tokio::try_join;

pub struct DashboardService {
    repo: Arc<dyn DashboardRepository>,
}

impl DashboardService {
    pub fn new(repo: Arc<dyn DashboardRepository>) -> Self {
        Self { repo }
    }

    /// Consolida todos os painéis do home em uma única resposta —
    /// consultas independentes executadas em paralelo no runtime.
    pub async fn consolidar(&self) -> AppResult<DashboardResponse> {
        let hoje = time::hoje();

        let (cards, ultimas, pend_in, pend_out, disp, ocupadas) = try_join!(
            self.repo.cards(hoje),
            self.repo.ultimas_reservas(10),
            self.repo.checkins_pendentes(hoje),
            self.repo.checkouts_pendentes(hoje),
            self.repo.acomodacoes_disponiveis_hoje(hoje),
            self.repo.acomodacoes_ocupadas(),
        )?;

        Ok(DashboardResponse {
            cards,
            ultimas_reservas: ultimas,
            checkins_pendentes: pend_in,
            checkouts_pendentes: pend_out,
            acomodacoes_disponiveis: disp
                .into_iter()
                .map(|(id, nome, numero)| AcomodacaoBasica { id, nome, numero })
                .collect(),
            acomodacoes_ocupadas: ocupadas
                .into_iter()
                .map(|(id, nome, numero)| AcomodacaoBasica { id, nome, numero })
                .collect(),
        })
    }
}
