//! `clarituz-api` — binário do servidor HTTP e CLI operacional.
//!
//! ```text
//! clarituz-api serve                       # sobe a API (default)
//! clarituz-api migrate                     # aplica migrations e sai
//! clarituz-api create-admin --login admin --nome "Admin" --senha <s>
//! clarituz-api s3-probe                    # diagnóstico do object store S3/MinIO
//! ```

mod bootstrap;
mod http;
mod workers;

use bootstrap::cli::{Cli, Cmd};
use clap::Parser;
use tracing_subscriber::{prelude::*, EnvFilter};

#[tokio::main]
async fn main() {
    let _sentry = init_sentry();
    init_tracing();
    if let Err(e) = run().await {
        eprintln!("erro fatal: {e}");
        std::process::exit(1);
    }
}

/// Sentry — desligado sem `SENTRY_DSN` (guard no-op, custo zero).
/// Captura panics e, via `sentry-tracing`, eventos `tracing::error!`.
fn init_sentry() -> sentry::ClientInitGuard {
    let dsn = std::env::var("SENTRY_DSN")
        .ok()
        .filter(|d| !d.is_empty())
        .and_then(|d| d.parse().ok());
    sentry::init(sentry::ClientOptions {
        dsn,
        release: sentry::release_name!(),
        environment: std::env::var("RAILWAY_ENVIRONMENT_NAME")
            .ok()
            .map(Into::into),
        ..Default::default()
    })
}

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,tower_http=debug,sqlx=warn"));
    tracing_subscriber::registry()
        .with(filter)
        .with(tracing_subscriber::fmt::layer().with_target(true).compact())
        .with(sentry_tracing::layer())
        .init();
}

async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();
    let settings = clarituz_shared::Settings::load()?;

    // S3Probe não toca no banco — útil justamente para isolar falhas de S3.
    if matches!(cli.cmd, Some(Cmd::S3Probe)) {
        return clarituz_infrastructure::s3_probe::run(&settings)
            .await
            .map_err(Into::into);
    }

    let pool =
        clarituz_infrastructure::connect(&settings.database_url, settings.db_max_connections)
            .await?;
    clarituz_infrastructure::migrate(&pool).await?;

    match cli.cmd.unwrap_or(Cmd::Serve) {
        Cmd::Migrate => {
            tracing::info!("migrations aplicadas");
            Ok(())
        }
        Cmd::CreateAdmin {
            login,
            nome,
            senha,
            nivel,
        } => bootstrap::create_admin(&pool, &login, &nome, &senha, nivel).await,
        Cmd::Serve => bootstrap::serve(settings, pool).await,
        Cmd::S3Probe => unreachable!("s3-probe retorna antes de conectar ao banco"),
    }
}
