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
//!
//! Também mora aqui o `AlertaErro`: observador de respostas 5xx que
//! dispara um POST fire-and-forget para `ALERT_WEBHOOK_URL`
//! (Discord/Slack genérico) — sem a env o layer nem é instalado.

use axum::extract::{ConnectInfo, Request, State};
use axum::http::{header, Method, StatusCode};
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

// ---------------------------------------------------------------------------
// alerta de erros 5xx → webhook externo (ALERT_WEBHOOK_URL)
// ---------------------------------------------------------------------------

/// Mesma (método, rota normalizada, status) não alerta de novo dentro
/// da janela — um endpoint quebrado gera 1 mensagem, não uma por request.
const ALERTA_DEDUP: Duration = Duration::from_secs(300);
/// Teto global de alertas/minuto — num incidente tudo falha junto e o
/// webhook vira flood; preferimos 20 mensagens e um aviso no log.
const ALERTA_MAX_POR_MIN: u32 = 20;
const ALERTA_JANELA: Duration = Duration::from_secs(60);
/// Varredura lazy do mapa de dedup (mesmo padrão do rate limit por IP).
const ALERTA_MAX_CHAVES: usize = 1_000;
/// Timeout do POST — webhooks de chat respondem rápido; 3s já é folga.
const ALERTA_TIMEOUT: Duration = Duration::from_secs(3);

/// Chave de dedup: método + path com segmentos numéricos mascarados
/// (`/clientes/42` e `/clientes/43` → mesma rota) + status.
type ChaveAlerta = (Method, String, u16);

struct AlertaEstado {
    vistos: HashMap<ChaveAlerta, Instant>,
    enviados: u32,
    janela_ini: Instant,
}

/// Observador de 5xx: POST `{"content": "🚨 …"}` (Discord) — o campo
/// `text` vai junto para webhooks Slack genéricos, que ignoram `content`.
///
/// NUNCA segura a request: a checagem de dedup/teto é uma seção crítica
/// de ~ns e o POST sai em `tokio::spawn` com timeout próprio. Falha de
/// entrega vira `warn` no log — o usuário nunca paga pelo alerta.
#[derive(Clone)]
pub struct AlertaErro {
    http: reqwest::Client,
    url: Arc<str>,
    estado: Arc<Mutex<AlertaEstado>>,
}

impl AlertaErro {
    /// `url` é o webhook (já validado não-vazio em `Settings`).
    pub fn novo(url: &str) -> Self {
        Self {
            http: reqwest::Client::builder()
                .timeout(ALERTA_TIMEOUT)
                .build()
                .unwrap_or_default(),
            url: url.into(),
            estado: Arc::new(Mutex::new(AlertaEstado {
                vistos: HashMap::new(),
                enviados: 0,
                janela_ini: Instant::now(),
            })),
        }
    }

    /// Middleware `from_fn_with_state` — instalar como layer mais externo
    /// para enxergar o status final (incl. o 500 do `CatchPanicLayer`).
    pub async fn middleware(State(a): State<Self>, req: Request, next: Next) -> Response {
        let metodo = req.method().clone();
        // path sem query — query pode carregar segredos (stream ticket).
        let path = mascara_ids(req.uri().path());
        let inicio = Instant::now();
        let res = next.run(req).await;
        let status = res.status();
        if status.is_server_error() {
            a.disparar(&metodo, &path, status, inicio.elapsed());
        }
        res
    }

    /// Seção crítica síncrona (dedup + teto global) e POST em background.
    fn disparar(&self, metodo: &Method, path: &str, status: StatusCode, dur: Duration) {
        {
            let mut e = self
                .estado
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if e.vistos.len() > ALERTA_MAX_CHAVES {
                e.vistos.retain(|_, t| t.elapsed() < ALERTA_DEDUP);
            }
            if e.janela_ini.elapsed() >= ALERTA_JANELA {
                e.enviados = 0;
                e.janela_ini = Instant::now();
            }
            let chave: ChaveAlerta = (metodo.clone(), path.to_string(), status.as_u16());
            if e.vistos
                .get(&chave)
                .is_some_and(|t| t.elapsed() < ALERTA_DEDUP)
            {
                return;
            }
            if e.enviados >= ALERTA_MAX_POR_MIN {
                tracing::warn!(
                    %metodo, %path, %status,
                    "alerta suprimido: teto global de {ALERTA_MAX_POR_MIN}/min atingido"
                );
                return;
            }
            e.enviados += 1;
            e.vistos.insert(chave, Instant::now());
        }

        let msg = format!(
            "🚨 [clarituz-api] {metodo} {path} → {} ({}ms)",
            status.as_u16(),
            dur.as_millis()
        );
        tracing::error!(%metodo, %path, %status, "resposta 5xx — alerta disparado");
        let http = self.http.clone();
        let url = self.url.clone();
        tokio::spawn(async move {
            let corpo = json!({"content": msg, "text": msg});
            if let Err(e) = http.post(&*url).json(&corpo).send().await {
                tracing::warn!(erro = %e, "alerta 5xx: POST do webhook falhou");
            }
        });
    }
}

/// Segmentos puramente numéricos viram `{id}` — ids variam por request e
/// quebrariam a dedup (e poluem o canal com ruído distinto por recurso).
fn mascara_ids(path: &str) -> String {
    path.split('/')
        .map(|seg| {
            if !seg.is_empty() && seg.bytes().all(|b| b.is_ascii_digit()) {
                "{id}"
            } else {
                seg
            }
        })
        .collect::<Vec<_>>()
        .join("/")
}
