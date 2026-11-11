//! Subida do servidor HTTP — wiring do estado, workers e
//! shutdown gracioso.

use crate::http::{router, state::AppState};
use crate::workers;
use clarituz_infrastructure::{spawn_pg_relay, EventBus};
use clarituz_shared::Settings;
use std::sync::Arc;

pub async fn serve(
    settings: Settings,
    pool: sqlx::PgPool,
) -> Result<(), Box<dyn std::error::Error>> {
    std::fs::create_dir_all(&settings.storage_dir).ok();
    let eventos = EventBus::new();
    spawn_pg_relay(pool.clone(), eventos.clone());
    let built = clarituz_infrastructure::build_services(&settings, &pool, &eventos);
    let state = AppState {
        services: Arc::new(built.services),
        issuer: built.issuer,
        pool: pool.clone(),
        storage_dir: settings.storage_dir.clone(),
        store: clarituz_infrastructure::build_store(&settings)
            .expect("object store inválido: confira as variáveis S3_*"),
        eventos,
        cors_origins: settings.cors_origins.clone(),
        stripe_webhook_secret: settings.stripe_webhook_secret.clone(),
        link_secret: settings.jwt_secret.clone(),
        vapid_public_b64: settings.vapid_public_b64.clone(),
        site_base: settings.site_base.clone(),
    };
    workers::spawn_all(&state, settings.stripe_secret_key.is_some());
    let app = router::build(state);

    let listener = tokio::net::TcpListener::bind(&settings.http_addr).await?;
    tracing::info!(addr = %settings.http_addr, "clarituz-api ouvindo");
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await?;
    Ok(())
}

/// Encerra no primeiro sinal recebido: SIGINT (dev) ou SIGTERM
/// (orquestrador — Railway/K8s mandam SIGTERM no deploy/scale-down;
/// sem isso requests em voo e SSE morriam no hard-kill).
async fn shutdown_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        let mut sigterm = match signal(SignalKind::terminate()) {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!(erro = %e, "falha ao registrar SIGTERM; usando só ctrl-c");
                let _ = tokio::signal::ctrl_c().await;
                return;
            }
        };
        tokio::select! {
            _ = tokio::signal::ctrl_c() => tracing::info!("desligamento solicitado (SIGINT)"),
            _ = sigterm.recv() => tracing::info!("desligamento solicitado (SIGTERM)"),
        }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
        tracing::info!("desligamento solicitado (ctrl-c)");
    }
}
