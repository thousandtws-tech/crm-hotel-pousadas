//! Rate limit por IP — janela fixa em memória, por instância.
//!
//! Protege os endpoints públicos caros: `/auth/login` e `/auth/register`
//! executam Argon2 (~50-100ms de CPU por tentativa — amplificador de DoS
//! e porta de brute-force) e `/publico/reservas` grava no banco. O teto
//! é por réplica — com N réplicas o limite efetivo é N×, suficiente para
//! deter abuso sem engessar a recepção.
//!
//! IP real: `X-Forwarded-For` (edge proxy do Railway) → peer TCP.
//! Varredura lazy remove janelas expiradas quando o mapa passa de 10k —
//! nenhum task de fundo, nenhuma dependência extra.

use axum::extract::{ConnectInfo, Request, State};
use axum::http::{header, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;
use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

const MAX_ENTRADAS: usize = 10_000;

#[derive(Clone)]
pub struct IpRateLimit {
    estado: Arc<Mutex<HashMap<IpAddr, (u32, Instant)>>>,
    max: u32,
    janela: Duration,
}

impl IpRateLimit {
    /// `max` requisições por `janela` por IP.
    pub fn novo(max: u32, janela: Duration) -> Self {
        Self {
            estado: Arc::new(Mutex::new(HashMap::new())),
            max,
            janela,
        }
    }

    fn lock(&self) -> MutexGuard<'_, HashMap<IpAddr, (u32, Instant)>> {
        self.estado
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn ip_de(req: &Request) -> Option<IpAddr> {
        req.headers()
            .get("x-forwarded-for")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.split(',').next())
            .and_then(|s| s.trim().parse().ok())
            .or_else(|| {
                req.extensions()
                    .get::<ConnectInfo<SocketAddr>>()
                    .map(|c| c.0.ip())
            })
    }

    /// Middleware `from_fn_with_state`.
    pub async fn middleware(State(lim): State<Self>, req: Request, next: Next) -> Response {
        let Some(ip) = Self::ip_de(&req) else {
            return next.run(req).await;
        };

        let retry_after = {
            let mut map = lim.lock();
            // varredura lazy — não deixa o mapa crescer sem teto
            if map.len() > MAX_ENTRADAS {
                map.retain(|_, (_, ini)| ini.elapsed() < lim.janela);
            }
            let (n, ini) = map.entry(ip).or_insert((0, Instant::now()));
            if ini.elapsed() >= lim.janela {
                *n = 0;
                *ini = Instant::now();
            }
            *n += 1;
            (*n > lim.max).then(|| lim.janela.saturating_sub(ini.elapsed()))
        };

        match retry_after {
            Some(retry) => (
                StatusCode::TOO_MANY_REQUESTS,
                [(header::RETRY_AFTER, retry.as_secs().max(1).to_string())],
                Json(json!({"erro": {"codigo": "RATE_LIMIT",
                    "mensagem": "Muitas tentativas. Aguarde um instante."}})),
            )
                .into_response(),
            None => next.run(req).await,
        }
    }
}

/// Security headers em toda resposta — só insere os ausentes, então o
/// `Cache-Control` dos GETs de mídia e headers específicos de rota
/// continuam valendo.
///
/// Dois pontos cirúrgicos além do baseline (nosniff/frame/referrer/HSTS):
/// payloads SVG/XML servidos pelo storage recebem `CSP: sandbox` — um
/// upload de logo malicioso renderiza como imagem mas nunca executa
/// script na origem da API (stored-XSS via upload).
pub async fn security_headers(req: Request, next: Next) -> Response {
    let mut res = next.run(req).await;
    let h = res.headers_mut();
    for (k, v) in [
        (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        (header::X_FRAME_OPTIONS, "DENY"),
        (header::REFERRER_POLICY, "no-referrer"),
        (
            header::STRICT_TRANSPORT_SECURITY,
            "max-age=31536000; includeSubDomains",
        ),
    ] {
        if !h.contains_key(&k) {
            h.insert(k, v.parse().expect("header estático"));
        }
    }
    let xml = h
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|ct| {
            ct.starts_with("image/svg")
                || ct.starts_with("text/xml")
                || ct.starts_with("application/xml")
        });
    if xml && !h.contains_key(header::CONTENT_SECURITY_POLICY) {
        h.insert(
            header::CONTENT_SECURITY_POLICY,
            "sandbox".parse().expect("header estático"),
        );
    }
    res
}
