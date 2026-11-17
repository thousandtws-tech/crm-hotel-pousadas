//! Fila de comunicação — drenagem da outbox a cada 30 s e agendador
//! de lembretes/pesquisas a cada hora (dedup por reserva+template no
//! repo garante envio único por hóspede).

use crate::http::state::AppState;

pub(crate) fn spawn_fila(state: &AppState) {
    let svc = state.services.comunicacao.clone();
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(std::time::Duration::from_secs(30));
        tick.tick().await;
        loop {
            tick.tick().await;
            if let Err(e) = svc.drenar_fila().await {
                tracing::warn!(erro = %e, "fila_envio: worker falhou");
            }
        }
    });
}

/// Agendador de lembretes/pesquisas — a cada hora (dedup por
/// reserva+template no repo garante envio único por hóspede).
pub(crate) fn spawn_lembretes(state: &AppState) {
    let svc = state.services.comunicacao.clone();
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(std::time::Duration::from_secs(3600));
        tick.tick().await;
        loop {
            tick.tick().await;
            if let Err(e) = svc.rodar_lembretes().await {
                tracing::warn!(erro = %e, "lembretes: rodada falhou");
            }
        }
    });
}

/// Sweeper da inbox Z-API — eventos que falharam no processamento
/// voltam a rodar (dedup por event_id impede efeito duplo).
pub(crate) fn spawn_zapi_eventos(state: &AppState) {
    let Some(zapi) = state.services.zapi.clone() else {
        return;
    };
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(std::time::Duration::from_secs(60));
        tick.tick().await;
        loop {
            tick.tick().await;
            if let Err(e) = zapi.reprocessar().await {
                tracing::warn!(erro = %e, "zapi: sweeper de eventos falhou");
            }
        }
    });
}
