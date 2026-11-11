use clarituz_domain::events::{Aviso, Delta, EventoApp};
use clarituz_domain::ports::{EventoPublisher, NotificacaoRepository};
use sqlx::postgres::PgListener;
use sqlx::PgPool;
use std::time::Duration;
use tokio::sync::broadcast;
use tokio::task::JoinHandle;

const CAPACIDADE: usize = 1024;

#[derive(Clone)]
pub struct EventBus {
    tx: broadcast::Sender<EventoApp>,
}

impl EventBus {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(CAPACIDADE);
        Self { tx }
    }

    pub fn assinar(&self) -> broadcast::Receiver<EventoApp> {
        self.tx.subscribe()
    }

    pub fn publicar(&self, ev: EventoApp) {
        let _ = self.tx.send(ev);
    }

    /// Assinantes vivos do bus — proxy para conexões SSE abertas nesta
    /// réplica (exportado como gauge de saturação no `/metrics`).
    pub fn assinantes(&self) -> usize {
        self.tx.receiver_count()
    }
}

impl Default for EventBus {
    fn default() -> Self {
        Self::new()
    }
}

impl EventoPublisher for EventBus {
    fn avisar(&self, aviso: clarituz_domain::events::Aviso) {
        self.publicar(EventoApp::Aviso(aviso));
    }
}

pub fn spawn_pg_relay(pool: PgPool, bus: EventBus) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut espera = Duration::from_secs(1);
        loop {
            match ouvir(&pool, &bus).await {
                Ok(()) => tracing::warn!("relay realtime: listener encerrado; reconectando"),
                Err(e) => tracing::warn!(erro = %e, "relay realtime caiu; reconectando"),
            }
            tokio::time::sleep(espera).await;
            espera = (espera * 2).min(Duration::from_secs(30));
        }
    })
}

pub fn spawn_aviso_persister(
    bus: EventBus,
    repo: std::sync::Arc<dyn NotificacaoRepository>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut rx = bus.assinar();
        loop {
            match rx.recv().await {
                Ok(EventoApp::Aviso(a)) => {
                    if let Err(e) = repo.registrar(&a).await {
                        tracing::warn!(erro = %e, "falha ao persistir notificação");
                    }
                }

                Ok(EventoApp::Delta(_) | EventoApp::AvisoPropagado(_)) => {}
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    tracing::warn!(perdidos = n, "persister lagado — avisos não persistidos");
                }
                Err(broadcast::error::RecvError::Closed) => return,
            }
        }
    })
}

async fn ouvir(pool: &PgPool, bus: &EventBus) -> Result<(), sqlx::Error> {
    let mut listener = PgListener::connect_with(pool).await?;
    listener
        .listen_all(["clarituz_delta", "clarituz_aviso"])
        .await?;
    tracing::info!("realtime: LISTEN clarituz_delta, clarituz_aviso");
    loop {
        let n = listener.recv().await?;
        match n.channel() {
            "clarituz_delta" => match serde_json::from_str::<Delta>(n.payload()) {
                Ok(d) => bus.publicar(EventoApp::Delta(d)),
                Err(e) => {
                    tracing::warn!(erro = %e, payload = n.payload(), "payload de delta inválido");
                }
            },
            "clarituz_aviso" => match serde_json::from_str::<Aviso>(n.payload()) {
                Ok(a) => bus.publicar(EventoApp::AvisoPropagado(a)),
                Err(e) => {
                    tracing::warn!(erro = %e, payload = n.payload(), "payload de aviso inválido");
                }
            },
            _ => {}
        }
    }
}
