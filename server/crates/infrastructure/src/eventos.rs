//! Motor realtime — `EventBus`.
//!
//! ```text
//!  services ──avisar()──▶ ┌───────────────┐ ◀── PgListener (LISTEN clarituz_delta)
//!                         │  broadcast::  │      triggers notify_delta()
//!                         │  channel 1024 │
//!                         └──────┬────────┘
//!                       assinar()│  → SSE /api/v1/notificacoes/stream
//! ```
//!
//! Um `tokio::broadcast` é lock-free e zero-copy (`Arc` interno): cada
//! assinante recebe todos os eventos; assinante lento recebe `Lagged` em
//! vez de travar o barramento — mesmo comportamento do realtime do
//! Supabase/Firebase.

use clarituz_domain::events::{Delta, EventoApp};
use clarituz_domain::ports::{EventoPublisher, NotificacaoRepository};
use sqlx::postgres::PgListener;
use sqlx::PgPool;
use std::time::Duration;
use tokio::sync::broadcast;
use tokio::task::JoinHandle;

/// Capacidade do ring buffer por assinante — ~1k eventos cobrem rajadas
/// (check-out em lote) sem pressão de memória.
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

    /// Nova assinatura — usada pelo handler SSE para cada conexão.
    pub fn assinar(&self) -> broadcast::Receiver<EventoApp> {
        self.tx.subscribe()
    }

    /// Fan-out; falha silenciosa quando não há assinantes (send só retorna
    /// Err se receiver_count == 0 — não é erro real).
    pub fn publicar(&self, ev: EventoApp) {
        let _ = self.tx.send(ev);
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

/// Relay PostgreSQL → bus: escuta `clarituz_delta` (emitido pelos triggers
/// `notify_delta`) e republica como `Delta`. Reconecta com backoff
/// exponencial (1s→30s) — o motor sobrevive a restart do banco.
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

/// Consumer do bus → histórico: todo `Aviso` vira linha em `notificacao`.
/// Desacoplado do caminho do request — falha de escrita só perde a notificação,
/// nunca a operação de negócio (at-least-once: o SSE chega mesmo se o banco falhar).
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
                Ok(EventoApp::Delta(_)) => {}
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
    listener.listen("clarituz_delta").await?;
    tracing::info!("realtime: LISTEN clarituz_delta");
    loop {
        let n = listener.recv().await?;
        match serde_json::from_str::<Delta>(n.payload()) {
            Ok(d) => bus.publicar(EventoApp::Delta(d)),
            Err(e) => {
                tracing::warn!(erro = %e, payload = n.payload(), "payload de delta inválido")
            }
        }
    }
}
