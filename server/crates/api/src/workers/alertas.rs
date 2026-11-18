//! Monitor de falhas operacionais — transforma falhas terminais da
//! outbox de envio (fila_envio) e do fiscal (NFS-e/Spedy) em alertas
//! internos no sino da equipe.
//!
//! Idempotente e seguro para N réplicas: a dedup `alerta_operacional`
//! é durável — cada ocorrência dispara no máximo um alerta, e falha
//! tardia de retry longo entra na janela normalmente.

use crate::http::state::AppState;

pub fn spawn(state: &AppState) {
    let svc = state.services.alertas.clone();
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(std::time::Duration::from_mins(15));
        tick.tick().await;
        loop {
            tick.tick().await;
            match svc.varrer().await {
                Ok(n) if n > 0 => {
                    tracing::info!(alertas = n, "monitor: falhas operacionais alertadas");
                }
                Ok(_) => {}
                Err(e) => {
                    tracing::warn!(erro = %e, "monitor: varredura de falhas falhou");
                }
            }
        }
    });
}
