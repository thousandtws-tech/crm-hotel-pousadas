//! `clarituz-api` — binário do servidor HTTP e CLI operacional.
//!
//! ```text
//! clarituz-api serve                       # sobe a API (default)
//! clarituz-api migrate                     # aplica migrations e sai
//! clarituz-api create-admin --login admin --nome "Admin" --senha <s>
//! ```

mod error;
mod extract;
mod router;
mod routes;
mod state;

use clap::{Parser, Subcommand};
use clarituz_application::services::*;
use clarituz_application::Services;
use clarituz_domain::entities::NovoLog;
use clarituz_domain::ports::{
    EventoPublisher, FuncionarioRepository, NovoFuncionario, PasswordHasher,
};
use clarituz_infrastructure::{
    repositories, spawn_aviso_persister, spawn_pg_relay, Argon2Hasher, EventBus, JwtIssuer,
};
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

/// Monta o grafo de dependências (composition root).
fn build_services(
    settings: &Settings,
    pool: &sqlx::PgPool,
    eventos: EventBus,
) -> (AppState, Arc<AuthService>) {
    use repositories::*;

    let funcionarios: Arc<dyn clarituz_domain::ports::FuncionarioRepository> =
        Arc::new(PgFuncionarioRepository::new(pool.clone()));
    let sessoes = Arc::new(PgSessaoRepository::new(pool.clone()));
    let acessos = Arc::new(PgLogAcessoRepository::new(pool.clone()));
    let logs = Arc::new(PgLogRepository::new(pool.clone()));
    let hasher: Arc<dyn PasswordHasher> = Arc::new(Argon2Hasher::new());
    let issuer: Arc<dyn clarituz_domain::ports::TokenIssuer> =
        Arc::new(JwtIssuer::new(&settings.jwt_secret));

    let auth = Arc::new(AuthService::new(
        funcionarios.clone(),
        sessoes,
        acessos,
        logs.clone(),
        hasher.clone(),
        issuer.clone(),
        settings.jwt_ttl_secs,
        settings.refresh_ttl_secs,
    ));

    let clientes_repo = Arc::new(PgClienteRepository::new(pool.clone()));
    let acom_repo = Arc::new(PgAcomodacaoRepository::new(pool.clone()));
    let pag_repo = Arc::new(PgFormaPagamentoRepository::new(pool.clone()));
    let reserva_repo = Arc::new(PgReservaRepository::new(pool.clone()));
    let impressora_repo = Arc::new(PgImpressoraRepository::new(pool.clone()));
    let impressora_gw: Arc<dyn clarituz_domain::ports::ImpressoraGateway> = Arc::new(
        clarituz_infrastructure::escpos::SpoolImpressora::new(pool.clone()),
    );
    let publisher: Arc<dyn EventoPublisher> = Arc::new(eventos.clone());
    // consumer do bus → histórico persistido (inbox/badges)
    let notif_repo = Arc::new(repositories::PgNotificacaoRepository::new(pool.clone()));
    spawn_aviso_persister(eventos.clone(), notif_repo.clone());

    let services = Services {
        auth: auth.clone(),
        clientes: Arc::new(ClienteService::new(clientes_repo.clone())),
        documentos: Arc::new(DocumentoService::new(
            Arc::new(PgDocumentoRepository::new(pool.clone())),
            clientes_repo.clone(),
        )),
        acomodacoes: Arc::new(AcomodacaoService::new(
            acom_repo.clone(),
            Arc::new(PgTipoAcomodacaoRepository::new(pool.clone())),
            Arc::new(PgQuartoRepository::new(pool.clone())),
        )),
        cms: Arc::new(CmsService::new(
            Arc::new(PgCmsRepository::new(pool.clone())),
            acom_repo.clone(),
        )),
        reservas: Arc::new(ReservaService::new(ReservaDeps {
            reservas: reserva_repo.clone(),
            acomodacoes: acom_repo.clone(),
            clientes: clientes_repo,
            pagamentos: pag_repo.clone(),
            estabelecimentos: Arc::new(PgEstabelecimentoRepository::new(pool.clone())),
            impressoras: impressora_repo.clone(),
            impressora: impressora_gw.clone(),
            auth: auth.clone(),
            eventos: publisher,
            acompanhantes: reserva_repo.clone(),
            fnrh: reserva_repo,
        })),
        estoque: Arc::new(
            EstoqueService::new(Arc::new(PgEstoqueRepository::new(pool.clone())))
                .com_etiquetas(impressora_repo.clone(), impressora_gw.clone()),
        ),
        frigobar: Arc::new(FrigobarService::new(
            Arc::new(PgFrigobarRepository::new(pool.clone())),
            acom_repo,
        )),
        estacionamento: Arc::new(EstacionamentoService::new(Arc::new(
            PgEstacionamentoRepository::new(pool.clone()),
        ))),
        pagamentos: Arc::new(PagamentoService::new(pag_repo)),
        funcionarios: Arc::new(FuncionarioService::new(funcionarios, hasher)),
        estabelecimento: Arc::new(EstabelecimentoService::new(Arc::new(
            PgEstabelecimentoRepository::new(pool.clone()),
        ))),
        impressoras: Arc::new(ImpressoraService::new(impressora_repo, impressora_gw)),
        financeiro: Arc::new(FinanceiroService::new(Arc::new(
            PgFinanceiroRepository::new(pool.clone()),
        ))),
        dashboard: Arc::new(DashboardService::new(Arc::new(PgDashboardRepository::new(
            pool.clone(),
        )))),
        auditoria: Arc::new(AuditoriaService::new(logs)),
        notificacoes: Arc::new(NotificacaoService::new(notif_repo)),
        busca: Arc::new(BuscaService::new(Arc::new(PgBuscaRepository::new(
            pool.clone(),
        )))),
        tesouraria: Arc::new(TesourariaService::new(Arc::new(
            PgTesourariaRepository::new(pool.clone()),
        ))),
        caixa: Arc::new(CaixaService::new(Arc::new(PgCaixaRepository::new(
            pool.clone(),
        )))),
        pdv: Arc::new(PdvService::new(Arc::new(PgPdvRepository::new(
            pool.clone(),
        )))),
        cafe: Arc::new(CafeService::new(Arc::new(PgCafeRepository::new(
            pool.clone(),
        )))),
        compras: Arc::new(ComprasService::new(
            Arc::new(PgComprasRepository::new(pool.clone())),
            Arc::new(PgEstoqueRepository::new(pool.clone())),
        )),
    };

    (
        AppState {
            services: Arc::new(services),
            issuer,
            pool: pool.clone(),
            storage_dir: settings.storage_dir.clone(),
            store: clarituz_infrastructure::build_store(&settings)
                .expect("object store inválido: confira as variáveis S3_*"),
            eventos,
        },
        auth,
    )
}

async fn serve(settings: Settings, pool: sqlx::PgPool) -> Result<(), Box<dyn std::error::Error>> {
    std::fs::create_dir_all(&settings.storage_dir).ok();
    let eventos = EventBus::new();
    spawn_pg_relay(pool.clone(), eventos.clone());
    let (state, _auth) = build_services(&settings, &pool, eventos);
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

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
    tracing::info!("desligamento solicitado (ctrl-c)");
}
