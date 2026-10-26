//! Rotas do CMS de quartos — admin edita conteúdo/mídia; site público lê
//! apenas o que está `publicado` (mais o SSE de deltas).

use crate::error::ApiError as AppError;
use crate::state::AppState;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, HeaderName, StatusCode};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use clarituz_application::actor::Ator;
use clarituz_application::dto::{CmsInput, OrdenarMidiaInput, StatusCmsInput};
use clarituz_domain::entities::{AcomodacaoCms, AcomodacaoCmsView, AcomodacaoMidia, AcomodacaoPublica};
use clarituz_domain::events::EventoApp;
use clarituz_domain::DomainError;
use std::convert::Infallible;
use std::time::Duration;
use tokio_stream::wrappers::errors::BroadcastStreamRecvError;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::{Stream, StreamExt};

// ---------------------------------------------------------------------------
// admin — conteúdo editorial
// ---------------------------------------------------------------------------

/// `GET /cms/acomodacoes` — acomodações + CMS + mídias (qualquer status).
pub async fn listar(
    State(s): State<AppState>,
    _ator: Ator,
) -> Result<Json<Vec<AcomodacaoCmsView>>, AppError> {
    Ok(Json(s.services.cms.listar().await?))
}

/// `PUT /cms/acomodacoes/{id}` — upsert do conteúdo editorial (admin).
pub async fn salvar(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(input): Json<CmsInput>,
) -> Result<Json<AcomodacaoCms>, AppError> {
    Ok(Json(s.services.cms.salvar(&ator, id, input).await?))
}

/// `PATCH /cms/acomodacoes/{id}/status` — `{publicar}` → publicado/rascunho.
pub async fn status(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(input): Json<StatusCmsInput>,
) -> Result<Json<AcomodacaoCms>, AppError> {
    Ok(Json(s.services.cms.publicar(&ator, id, input.publicar).await?))
}

// ---------------------------------------------------------------------------
// admin — mídia
// ---------------------------------------------------------------------------

const MAX_FOTO: usize = 8 * 1024 * 1024;
const MAX_VIDEO: usize = 80 * 1024 * 1024;

/// `POST /cms/acomodacoes/{id}/midia` — bytes crus no body,
/// `Content-Type: image/*` (≤ 8 MB) ou `video/mp4|webm` (≤ 80 MB).
pub async fn upload_midia(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<(StatusCode, Json<AcomodacaoMidia>), AppError> {
    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_lowercase();

    let (tipo, ext, limite) = match content_type.as_str() {
        m if m.starts_with("image/") => {
            let ext = match m {
                "image/png" => "png",
                "image/webp" => "webp",
                _ => "jpg",
            };
            ("foto", ext, MAX_FOTO)
        }
        "video/mp4" => ("video", "mp4", MAX_VIDEO),
        "video/webm" => ("video", "webm", MAX_VIDEO),
        _ => {
            return Err(DomainError::validacao(
                "Envie imagem (png, jpg, webp) ou vídeo (mp4, webm).",
            )
            .into())
        }
    };
    if body.is_empty() || body.len() > limite {
        return Err(DomainError::validacao(format!(
            "Arquivo vazio ou maior que {} MB.",
            limite / 1024 / 1024
        ))
        .into());
    }

    let dir = std::path::Path::new(&s.storage_dir)
        .join("cms")
        .join(id.to_string());
    std::fs::create_dir_all(&dir).map_err(|_| DomainError::Infra)?;
    let nome = format!("{}.{ext}", uuid_simple());
    let path = dir.join(&nome);
    std::fs::write(&path, &body).map_err(|_| DomainError::Infra)?;

    let midia = s
        .services
        .cms
        .adicionar_midia(&ator, id, tipo, &path.to_string_lossy(), &content_type)
        .await?;
    Ok((StatusCode::CREATED, Json(midia)))
}

/// `DELETE /cms/midia/{id}` — remove metadado + arquivo.
pub async fn remover_midia(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
) -> Result<StatusCode, AppError> {
    let anterior = s.services.cms.remover_midia(&ator, id).await?;
    if let Some(c) = anterior {
        std::fs::remove_file(c).ok();
    }
    Ok(StatusCode::NO_CONTENT)
}

/// `PATCH /cms/midia/{id}/capa` — marca a foto como capa da acomodação.
pub async fn definir_capa(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<serde_json::Value>, AppError> {
    s.services.cms.definir_capa(&ator, id).await?;
    Ok(Json(serde_json::json!({"ok": true})))
}

/// `PATCH /cms/acomodacoes/{id}/midia/ordem` — `{ordem: [ids]}`.
pub async fn ordenar_midia(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(input): Json<OrdenarMidiaInput>,
) -> Result<Json<serde_json::Value>, AppError> {
    s.services
        .cms
        .reordenar_midias(&ator, id, input.ordem)
        .await?;
    Ok(Json(serde_json::json!({"ok": true})))
}

fn uuid_simple() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let t = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{t:x}{:x}", std::process::id())
}

// ---------------------------------------------------------------------------
// público — site da pousada
// ---------------------------------------------------------------------------

/// `GET /publico/acomodacoes` — cards `publicado` + acomodação ativa.
pub async fn publico_listar(
    State(s): State<AppState>,
) -> Result<Json<Vec<AcomodacaoPublica>>, AppError> {
    Ok(Json(s.services.cms.listar_publicadas().await?))
}

/// `GET /publico/acomodacoes/{slug}` — detalhe publicado.
pub async fn publico_detalhe(
    State(s): State<AppState>,
    Path(slug): Path<String>,
) -> Result<Json<AcomodacaoPublica>, AppError> {
    Ok(Json(s.services.cms.publicada_por_slug(&slug).await?))
}

/// `GET /midia/{id}` — binário público: só mídia de acomodação `publicado`.
/// Rascunho não vaza (retorna 404 igual a inexistente).
pub async fn servir_midia(
    State(s): State<AppState>,
    Path(id): Path<i64>,
) -> Result<([(HeaderName, String); 2], Vec<u8>), AppError> {
    let Some((caminho, mime, publicado)) = s.services.cms.caminho_midia(id).await? else {
        return Err(DomainError::nao_encontrado("Mídia não encontrada.").into());
    };
    if !publicado {
        return Err(DomainError::nao_encontrado("Mídia não encontrada.").into());
    }
    servir_arquivo(&caminho, &mime)
}

/// `GET /cms/midia/{id}/arquivo` — preview autenticado (enxerga rascunho).
pub async fn servir_midia_admin(
    State(s): State<AppState>,
    _ator: Ator,
    Path(id): Path<i64>,
) -> Result<([(HeaderName, String); 2], Vec<u8>), AppError> {
    let Some((caminho, mime, _)) = s.services.cms.caminho_midia(id).await? else {
        return Err(DomainError::nao_encontrado("Mídia não encontrada.").into());
    };
    servir_arquivo(&caminho, &mime)
}

fn servir_arquivo(
    caminho: &str,
    mime: &str,
) -> Result<([(HeaderName, String); 2], Vec<u8>), AppError> {
    let bytes = std::fs::read(caminho)
        .map_err(|_| DomainError::nao_encontrado("Arquivo não encontrado no storage."))?;
    Ok((
        [
            (header::CONTENT_TYPE, mime.to_string()),
            (header::CACHE_CONTROL, "public, max-age=3600".into()),
        ],
        bytes,
    ))
}

/// `GET /publico/stream` — SSE público: só `delta` de tabelas do site
/// (cms + acomodacao, para preço/status refletirem na hora). Sem auth,
/// sem `aviso` (que carrega dados internos).
pub async fn publico_stream(
    State(s): State<AppState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let eventos = BroadcastStream::new(s.eventos.assinar()).filter_map(|r| match r {
        Ok(EventoApp::Delta(d))
            if matches!(
                d.tabela.as_str(),
                "acomodacao" | "acomodacao_cms" | "acomodacao_midia"
            ) =>
        {
            Some(Ok(Event::default()
                .event("delta")
                .data(serde_json::to_string(&d).unwrap_or_default())))
        }
        Ok(_) => None,
        Err(BroadcastStreamRecvError::Lagged(_)) => {
            Some(Ok(Event::default().comment("lagged")))
        }
    });

    Sse::new(eventos).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("ping"),
    )
}
