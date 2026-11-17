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
