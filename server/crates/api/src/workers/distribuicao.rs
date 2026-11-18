//! Worker de distribuição (Channex) — dois laços independentes:
//!
//! - **Outbox ARI** (10s): publica disponibilidade/restrições
//!   recalculadas. Idempotente — a mudança é re-calculada no envio, e o
//!   retry com contador vira pendência após o teto.
//! - **Feed de revisões** (30s): fonte primária de reservas OTA —
//!   webhook é apenas o sinal antecipado. Idempotente por dedup de
//!   `revision_id` + ACK recuperável; seguro para N réplicas.

use crate::http::state::AppState;

pub fn spawn(state: &AppState) {
    let Some(svc) = state.services.distribuicao.clone() else {
        return; // sem vault não há chave para publicar/puxar
    };

    let outbox = svc.clone();
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(std::time::Duration::from_secs(10));
        tick.tick().await;
        loop {
            tick.tick().await;
            match outbox.drenar_outbox().await {
                Ok(n) if n > 0 => {
                    tracing::info!(enviados = n, "channex: outbox drenada");
                }
                Ok(_) => {}
                Err(e) => {
                    tracing::warn!(erro = %e, "channex: outbox falhou");
                }
            }
        }
    });

    tokio::spawn(async move {
        let mut tick = tokio::time::interval(std::time::Duration::from_secs(30));
        tick.tick().await;
        loop {
            tick.tick().await;
            match svc.poll_feed().await {
                Ok(n) if n > 0 => {
                    tracing::info!(importadas = n, "channex: revisões importadas");
                }
                Ok(_) => {}
                Err(e) => {
                    tracing::warn!(erro = %e, "channex: feed falhou");
                }
            }
        }
    });
}
