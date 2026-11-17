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
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() {
    init_tracing();
    if let Err(e) = run().await {
        eprintln!("erro fatal: {e}");
        std::process::exit(1);
    }
}

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,tower_http=debug,sqlx=warn"));
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(true)
        .compact()
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
