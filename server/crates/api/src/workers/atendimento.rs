//! Escalada de SLA — a cada 60 s escala protocolos abertos cujo
//! aceite venceu.

use crate::http::state::AppState;

pub(crate) fn spawn(state: &AppState) {
    let atend = state.services.atendimento.clone();
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(std::time::Duration::from_secs(60));
        tick.tick().await;
        loop {
            tick.tick().await;
            if let Err(e) = atend.sweep().await {
                tracing::warn!(erro = %e, "atendimento: sweep falhou");
            }
        }
    });
}
