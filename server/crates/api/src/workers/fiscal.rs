//! Worker fiscal — transmite a fila de NFS-e confirmadas.
//!
//! Idempotente e seguro para N réplicas: `reivindicar_fila` usa
//! `FOR UPDATE SKIP LOCKED` e o `integrationId` é estável por documento,
//! então nem concorrência nem timeout geram nota duplicada no provedor.

use crate::http::state::AppState;

pub fn spawn(state: &AppState) {
    let Some(svc) = state.services.fiscal.clone() else {
        return; // sem vault não há chave para transmitir
    };
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(std::time::Duration::from_secs(30));
        tick.tick().await;
        loop {
            tick.tick().await;
            match svc.drenar_fila().await {
                Ok(n) if n > 0 => {
                    tracing::info!(transmitidas = n, "fila fiscal drenada");
                }
                Ok(_) => {}
                Err(e) => {
                    tracing::warn!(erro = %e, "fila fiscal: drenagem falhou");
                }
            }
        }
    });
}
