//! Sweeper de conciliação: holds expirados, webhooks falhos e
//! pagamentos pendentes consultados direto no provedor (a cada 5 min).

use crate::http::state::AppState;

pub(crate) fn spawn(state: &AppState) {
    let svc = state.services.pagamentos_online.clone();
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(std::time::Duration::from_secs(300));
        tick.tick().await; // pula o disparo imediato do boot
        loop {
            tick.tick().await;
            if let Err(e) = svc.conciliar().await {
                tracing::warn!(erro = %e, "conciliação de pagamentos falhou");
            }
        }
    });
}
