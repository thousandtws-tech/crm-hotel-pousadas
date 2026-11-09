//! `GET /notificacoes/stream` — stream SSE do motor realtime.
//!
//! Cada conexão assina o `EventBus` (tokio broadcast) e recebe dois canais:
//! * `delta` — mudança de dados vinda dos triggers PG (`{tabela,acao,id}`);
//! * `aviso` — evento semântico persistido e propagado pelo relay PG
//!   (`{tipo,titulo,mensagem,…}`), filtrado por `ate_nivel` (avisos de
//!   admin não chegam à recepção). Via relay = exactly-once por cliente
//!   em qualquer número de réplicas da API.
//!
//! Keep-alive a cada 15s mantém proxies/Nginx felizes; clientes lentos
//! recebem `Lagged` (broadcast descarta o backlog) em vez de travar o bus.

use crate::error::ApiError as AppError;
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use chrono::{Duration as ChronoDuration, Utc};
use clarituz_application::actor::Ator;
use clarituz_domain::entities::Notificacao;
use clarituz_domain::events::EventoApp;
use clarituz_domain::{DomainError, TokenClaims};
use clarituz_shared::{Page, PageParams};
use serde_json::json;
use std::convert::Infallible;
use std::time::Duration;
use tokio_stream::wrappers::errors::BroadcastStreamRecvError;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::{Stream, StreamExt};

/// Vida do stream ticket: cobre conexão + reconexões imediatas do
/// EventSource; expirado, o cliente pede outro (POST stream-ticket).
const STREAM_TICKET_TTL_SECS: i64 = 120;

/// `POST /notificacoes/stream-ticket` — emite ticket JWT curto de escopo
/// único (`aud = "sse"`) para `GET /notificacoes/stream?ticket=`. O access
/// token nunca sai do header Authorization nem entra em URL/log.
pub async fn stream_ticket(
    State(s): State<AppState>,
    ator: Ator,
) -> Result<Json<serde_json::Value>, AppError> {
    let now = Utc::now();
    let exp = now + ChronoDuration::seconds(STREAM_TICKET_TTL_SECS);
    let claims = TokenClaims {
        sub: ator.id.to_string(),
        login: ator.login,
        nome: ator.nome,
        nivel: ator.nivel.as_i16(),
        financeiro: ator.financeiro,
        iat: now.timestamp(),
        exp: exp.timestamp(),
        iss: "clarituz-api".into(),
        aud: Some("sse".into()),
    };
    let ticket = s.issuer.emitir(&claims)?;
    Ok(Json(
        json!({"ticket": ticket, "expira_em": exp.timestamp()}),
    ))
}

#[derive(serde::Deserialize)]
pub struct StreamTicket {
    ticket: String,
}

pub async fn stream(
    State(s): State<AppState>,
    Query(q): Query<StreamTicket>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, AppError> {
    let claims = s.issuer.validar(&q.ticket)?;
    if claims.aud.as_deref() != Some("sse") {
        return Err(DomainError::proibido("Credencial não é um stream ticket.").into());
    }
    let nivel = claims.nivel;
    tracing::info!(funcionario = %claims.sub, nivel, "cliente realtime conectado");

    let eventos = BroadcastStream::new(s.eventos.assinar()).filter_map(move |r| match r {
        Ok(EventoApp::Delta(d)) => Some(Ok(Event::default()
            .event("delta")
            .data(serde_json::to_string(&d).unwrap_or_default()))),
        // Só AvisoPropagado (relay PG) vai ao SSE — o Aviso local é a
        // entrada do persister; emiti-lo aqui duplicaria o toast na
        // réplica que publicou (local + NOTIFY) e não escalaria.
        Ok(EventoApp::AvisoPropagado(a)) if nivel <= a.ate_nivel => Some(Ok(Event::default()
            .event("aviso")
            .data(serde_json::to_string(&a).unwrap_or_default()))),
        Ok(_) => None,
        Err(BroadcastStreamRecvError::Lagged(n)) => {
            tracing::warn!(
                perdidos = n,
                "assinante realtime lagado — eventos descartados"
            );
            Some(Ok(Event::default().comment(format!("lagged {n}"))))
        }
    });

    Ok(Sse::new(eventos).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("ping"),
    ))
}

// ---------------------------------------------------------------------------
// histórico / inbox
// ---------------------------------------------------------------------------

/// `GET /notificacoes` — inbox paginado (mais recentes primeiro).
pub async fn inbox(
    State(s): State<AppState>,
    ator: Ator,
    Query(page): Query<PageParams>,
) -> Result<Json<Page<Notificacao>>, AppError> {
    Ok(Json(s.services.notificacoes.inbox(&ator, page).await?))
}

/// `GET /notificacoes/nao-lidas` — badge do sino.
pub async fn nao_lidas(
    State(s): State<AppState>,
    ator: Ator,
) -> Result<Json<serde_json::Value>, AppError> {
    let total = s.services.notificacoes.nao_lidas(&ator).await?;
    Ok(Json(json!({"total": total})))
}

/// `POST /notificacoes/{id}/ler` — read receipt (idempotente).
pub async fn ler(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<serde_json::Value>, AppError> {
    s.services.notificacoes.marcar_lida(&ator, id).await?;
    Ok(Json(json!({"ok": true})))
}

/// `POST /notificacoes/ler-todas`.
pub async fn ler_todas(
    State(s): State<AppState>,
    ator: Ator,
) -> Result<Json<serde_json::Value>, AppError> {
    let n = s.services.notificacoes.marcar_todas(&ator).await?;
    Ok(Json(json!({"ok": true, "marcadas": n})))
}

/// `DELETE /notificacoes/{id}` — remove do histórico (só admin).
pub async fn excluir(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<serde_json::Value>, AppError> {
    s.services.notificacoes.excluir(&ator, id).await?;
    Ok(Json(json!({"ok": true})))
}

// ---------------------------------------------------------------------------
// busca global do header
// ---------------------------------------------------------------------------

#[derive(serde::Deserialize)]
pub struct BuscaQuery {
    q: Option<String>,
}

/// `GET /busca?q=…` — hits agrupáveis por entidade, com deep-link `rota`.
pub async fn busca(
    State(s): State<AppState>,
    ator: Ator,
    Query(q): Query<BuscaQuery>,
) -> Result<Json<Vec<clarituz_domain::entities::ItemBusca>>, AppError> {
    Ok(Json(
        s.services
            .busca
            .buscar(&ator, q.q.as_deref().unwrap_or(""))
            .await?,
    ))
}
