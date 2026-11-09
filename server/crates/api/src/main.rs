//! `clarituz-api` — binário do servidor HTTP e CLI operacional.
//!
//! ```text
//! clarituz-api serve                       # sobe a API (default)
//! clarituz-api migrate                     # aplica migrations e sai
//! clarituz-api create-admin --login admin --nome "Admin" --senha <s>
//! clarituz-api s3-probe                    # diagnóstico do object store S3/MinIO
//! ```

mod error;
mod extract;
mod mw;
mod router;
mod routes;
mod state;

use axum_prometheus::metrics;
use clap::{Parser, Subcommand};
use clarituz_domain::entities::NovoLog;
use clarituz_domain::ports::{FuncionarioRepository, NovoFuncionario, PasswordHasher};
use clarituz_infrastructure::{repositories, spawn_pg_relay, Argon2Hasher, EventBus};
use clarituz_shared::Settings;
use state::AppState;
use std::sync::Arc;
use tracing_subscriber::EnvFilter;

#[derive(Parser)]
#[command(name = "clarituz-api", about = "Backend do CRM da pousada")]
struct Cli {
    #[command(subcommand)]
    cmd: Option<Cmd>,
}

#[derive(Subcommand)]
enum Cmd {
    /// Sobe o servidor HTTP (default).
    Serve,
    /// Aplica as migrations do banco e sai.
    Migrate,
    /// Cria um funcionário administrador (bootstrap/seed).
    CreateAdmin {
        #[arg(long)]
        login: String,
        #[arg(long)]
        nome: String,
        #[arg(long)]
        senha: String,
        #[arg(long, default_value_t = 1)]
        nivel: i16,
    },
    /// Diagnóstico do object store — lista buckets, garante o bucket de
    /// mídia e exercita put/get/delete. Não usa o banco (roda com o PG fora).
    S3Probe,
}

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
    let settings = Settings::load()?;

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
        } => create_admin(&pool, &login, &nome, &senha, nivel).await,
        Cmd::Serve => serve(settings, pool).await,
        Cmd::S3Probe => unreachable!("s3-probe retorna antes de conectar ao banco"),
    }
}

async fn create_admin(
    pool: &sqlx::PgPool,
    login: &str,
    nome: &str,
    senha: &str,
    nivel: i16,
) -> Result<(), Box<dyn std::error::Error>> {
    if senha.len() < 8 {
        return Err("senha deve ter ao menos 8 caracteres".into());
    }
    let hasher = Argon2Hasher::new();
    let repo = repositories::PgFuncionarioRepository::new(pool.clone());
    if repo.login_em_uso(login, 0).await? {
        return Err(format!("login '{login}' já existe").into());
    }
    let f = repo
        .criar(
            &NovoFuncionario {
                nome: nome.to_string(),
                login: login.to_lowercase(),
                senha_hash: hasher.hash(senha)?,
                cpf: None,
                data_nascimento: None,
                nivel,
                ativo: true,
            },
            NovoLog {
                idfuncionario: None,
                acao: "seed".into(),
                obs: format!("Criação inicial do administrador '{login}'"),
                tabela: "funcionario",
                idtabela: 0,
                dados: None,
            },
        )
        .await?;
    tracing::info!(id = f.id, login = %f.login, "administrador criado");
    Ok(())
}

async fn serve(settings: Settings, pool: sqlx::PgPool) -> Result<(), Box<dyn std::error::Error>> {
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
        vapid_public_b64: settings.vapid_public_b64.clone(),
    };
    // Sweeper de conciliação: holds expirados, webhooks falhos e
    // pagamentos pendentes consultados direto no provedor (a cada 5min).
    if settings.stripe_secret_key.is_some() {
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
    // Fila de comunicação — worker drena a outbox a cada 30s; o agendador
    // roda lembretes/pesquisas a cada hora (dedup por reserva+template no
    // repo garante envio único por hóspede).
    {
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
    spawn_metricas_saturacao(pool.clone(), state.eventos.clone());
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

/// Gauges de saturação a cada 10 s, exportados no `/metrics`:
/// pool do Postgres (size/idle) e assinantes do bus (≈ conexões SSE
/// abertas na réplica). `idle → 0` sustentado = hora de subir réplica
/// ou `DB_MAX_CONNECTIONS`.
fn spawn_metricas_saturacao(pool: sqlx::PgPool, eventos: EventBus) {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(std::time::Duration::from_secs(10));
        loop {
            tick.tick().await;
            metrics::gauge!("clarituz_db_pool_connections").set(pool.size() as f64);
            metrics::gauge!("clarituz_db_pool_idle").set(pool.num_idle() as f64);
            metrics::gauge!("clarituz_db_pool_max")
                .set(pool.options().get_max_connections() as f64);
            metrics::gauge!("clarituz_sse_subscribers").set(eventos.assinantes() as f64);
        }
    });
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
