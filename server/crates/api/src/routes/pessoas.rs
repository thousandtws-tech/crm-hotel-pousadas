//! Endpoints de clientes e funcionários.

use crate::error::ApiError as AppError;
use crate::state::AppState;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, HeaderName, StatusCode};
use axum::Json;
use clarituz_application::actor::Ator;
use clarituz_application::dto::{
    AtivoInput, ClienteInput, DocumentoInput, FuncionarioInput, FuncionarioUpdate,
};
use clarituz_domain::entities::{Cliente, ClienteDocumento, Fnrh, Funcionario};
use clarituz_domain::DomainError;
use clarituz_shared::{Page, PageParams};
use serde::Deserialize;

// ---------------------------------------------------------------------------
// clientes
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct ClientesQuery {
    #[serde(flatten)]
    pub page: PageParams,
    pub busca: Option<String>,
    #[serde(default)]
    pub apenas_ativos: bool,
}

pub async fn listar_clientes(
    State(s): State<AppState>,
    _ator: Ator,
    Query(q): Query<ClientesQuery>,
) -> Result<Json<Page<Cliente>>, AppError> {
    Ok(Json(
        s.services
            .clientes
            .listar(q.busca, q.apenas_ativos, q.page)
            .await?,
    ))
}

pub async fn buscar_cliente(
    State(s): State<AppState>,
    _ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<Cliente>, AppError> {
    Ok(Json(s.services.clientes.buscar(id).await?))
}

pub async fn criar_cliente(
    State(s): State<AppState>,
    ator: Ator,
    Json(body): Json<ClienteInput>,
) -> Result<(axum::http::StatusCode, Json<Cliente>), AppError> {
    let c = s.services.clientes.criar(&ator, body).await?;
    Ok((axum::http::StatusCode::CREATED, Json(c)))
}

pub async fn atualizar_cliente(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(body): Json<ClienteInput>,
) -> Result<Json<Cliente>, AppError> {
    Ok(Json(s.services.clientes.atualizar(&ator, id, body).await?))
}

pub async fn status_cliente(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(body): Json<AtivoInput>,
) -> Result<Json<Cliente>, AppError> {
    Ok(Json(
        s.services
            .clientes
            .definir_ativo(&ator, id, body.ativo)
            .await?,
    ))
}

/// Foto do cliente (recepção): imagem cruda no body, `Content-Type: image/*`,
/// ≤ 4 MB. Persiste em `storage_dir/clientes/{id}.{ext}` e registra o caminho.
pub async fn upload_foto_cliente(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<StatusCode, AppError> {
    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if !content_type.starts_with("image/") {
        return Err(DomainError::validacao("Envie uma imagem (png, jpg ou webp).").into());
    }
    if body.is_empty() || body.len() > 4 * 1024 * 1024 {
        return Err(DomainError::validacao("Imagem vazia ou maior que 4 MB.").into());
    }
    s.services.clientes.buscar(id).await?;
    let anterior = s.services.clientes.foto_caminho(id).await?;

    let ext = content_type
        .strip_prefix("image/")
        .map(|e| e.replace("jpeg", "jpg"))
        .unwrap_or_else(|| "bin".into());
    let dir = std::path::Path::new(&s.storage_dir).join("clientes");
    std::fs::create_dir_all(&dir).map_err(|_| DomainError::Infra)?;
    let path = dir.join(format!("{id}.{ext}"));
    std::fs::write(&path, &body).map_err(|_| DomainError::Infra)?;

    s.services
        .clientes
        .definir_foto(&ator, id, &path.to_string_lossy())
        .await?;
    if let Some(antigo) = anterior.filter(|a| a != &path.to_string_lossy()) {
        std::fs::remove_file(antigo).ok();
    }
    Ok(StatusCode::CREATED)
}

/// Serve a foto do cliente — `404` quando não cadastrada.
pub async fn foto_cliente(
    State(s): State<AppState>,
    _ator: Ator,
    Path(id): Path<i64>,
) -> Result<([(HeaderName, String); 2], Vec<u8>), AppError> {
    let Some(caminho) = s.services.clientes.foto_caminho(id).await? else {
        return Err(DomainError::nao_encontrado("Cliente não possui foto.").into());
    };
    let bytes = std::fs::read(&caminho).map_err(|_| {
        DomainError::nao_encontrado("Arquivo de foto não encontrado no storage.")
    })?;
    let mime = match caminho.rsplit('.').next() {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        _ => "application/octet-stream",
    };
    Ok((
        [
            (header::CONTENT_TYPE, mime.to_string()),
            (header::CACHE_CONTROL, "private, max-age=60".into()),
        ],
        bytes,
    ))
}

/// Remove a foto do cliente (coluna + arquivo no storage).
pub async fn remover_foto_cliente(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
) -> Result<StatusCode, AppError> {
    let anterior = s.services.clientes.remover_foto(&ator, id).await?;
    std::fs::remove_file(anterior).ok();
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// documentos de identidade do cliente
// ---------------------------------------------------------------------------

pub async fn listar_documentos(
    State(s): State<AppState>,
    _ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<Vec<ClienteDocumento>>, AppError> {
    Ok(Json(s.services.documentos.listar(id).await?))
}

pub async fn criar_documento(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(body): Json<DocumentoInput>,
) -> Result<(StatusCode, Json<ClienteDocumento>), AppError> {
    let d = s.services.documentos.criar(&ator, id, body).await?;
    Ok((StatusCode::CREATED, Json(d)))
}

pub async fn atualizar_documento(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(body): Json<DocumentoInput>,
) -> Result<Json<ClienteDocumento>, AppError> {
    Ok(Json(s.services.documentos.atualizar(&ator, id, body).await?))
}

/// Exclui o documento e apaga o arquivo de scan, se houver.
pub async fn remover_documento(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
) -> Result<StatusCode, AppError> {
    if let Some(scan) = s.services.documentos.remover(&ator, id).await? {
        std::fs::remove_file(scan).ok();
    }
    Ok(StatusCode::NO_CONTENT)
}

/// Scan do documento (imagem cruda no body, `Content-Type: image/*`, ≤ 4 MB).
/// Persiste em `storage_dir/documentos/{id}.{ext}` e registra o caminho.
pub async fn upload_scan_documento(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<StatusCode, AppError> {
    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if !content_type.starts_with("image/") {
        return Err(DomainError::validacao("Envie uma imagem (png, jpg ou webp).").into());
    }
    if body.is_empty() || body.len() > 4 * 1024 * 1024 {
        return Err(DomainError::validacao("Imagem vazia ou maior que 4 MB.").into());
    }
    s.services.documentos.buscar(id).await?;
    let anterior = s.services.documentos.scan_caminho(id).await?;
    let ext = content_type
        .strip_prefix("image/")
        .map(|e| e.replace("jpeg", "jpg"))
        .unwrap_or_else(|| "bin".into());
    let dir = std::path::Path::new(&s.storage_dir).join("documentos");
    std::fs::create_dir_all(&dir).map_err(|_| DomainError::Infra)?;
    let path = dir.join(format!("{id}.{ext}"));
    std::fs::write(&path, &body).map_err(|_| DomainError::Infra)?;

    s.services
        .documentos
        .definir_scan(&ator, id, &path.to_string_lossy())
        .await?;
    if let Some(antigo) = anterior.filter(|a| a != &path.to_string_lossy()) {
        std::fs::remove_file(antigo).ok();
    }
    Ok(StatusCode::CREATED)
}

/// Serve o scan do documento — `404` quando não digitalizado.
pub async fn scan_documento(
    State(s): State<AppState>,
    _ator: Ator,
    Path(id): Path<i64>,
) -> Result<([(HeaderName, String); 2], Vec<u8>), AppError> {
    let Some(caminho) = s.services.documentos.scan_caminho(id).await? else {
        return Err(DomainError::nao_encontrado("Documento não possui scan.").into());
    };
    let bytes = std::fs::read(&caminho).map_err(|_| {
        DomainError::nao_encontrado("Arquivo de scan não encontrado no storage.")
    })?;
    let mime = match caminho.rsplit('.').next() {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        _ => "application/octet-stream",
    };
    Ok((
        [
            (header::CONTENT_TYPE, mime.to_string()),
            (header::CACHE_CONTROL, "private, max-age=60".into()),
        ],
        bytes,
    ))
}

/// Remove apenas o scan do documento (mantém os dados).
pub async fn remover_scan_documento(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
) -> Result<StatusCode, AppError> {
    let anterior = s.services.documentos.remover_scan(&ator, id).await?;
    std::fs::remove_file(anterior).ok();
    Ok(StatusCode::NO_CONTENT)
}

/// Arquivo digital do hóspede — FNRHs emitidas em todas as estadias.
pub async fn fnrh_cliente(
    State(s): State<AppState>,
    _ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<Vec<Fnrh>>, AppError> {
    Ok(Json(s.services.reservas.listar_fnrh_cliente(id).await?))
}

// ---------------------------------------------------------------------------
// funcionários
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct FuncionariosQuery {
    #[serde(flatten)]
    pub page: PageParams,
    #[serde(default)]
    pub apenas_ativos: bool,
}

pub async fn listar_funcionarios(
    State(s): State<AppState>,
    ator: Ator,
    Query(q): Query<FuncionariosQuery>,
) -> Result<Json<Page<Funcionario>>, AppError> {
    ator.exigir_gerencial()?;
    Ok(Json(
        s.services
            .funcionarios
            .listar(q.apenas_ativos, q.page)
            .await?,
    ))
}

pub async fn buscar_funcionario(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<Funcionario>, AppError> {
    ator.exigir_gerencial()?;
    Ok(Json(s.services.funcionarios.buscar(id).await?))
}

pub async fn criar_funcionario(
    State(s): State<AppState>,
    ator: Ator,
    Json(body): Json<FuncionarioInput>,
) -> Result<(axum::http::StatusCode, Json<Funcionario>), AppError> {
    let f = s.services.funcionarios.criar(&ator, body).await?;
    Ok((axum::http::StatusCode::CREATED, Json(f)))
}

pub async fn atualizar_funcionario(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(body): Json<FuncionarioUpdate>,
) -> Result<Json<Funcionario>, AppError> {
    Ok(Json(
        s.services.funcionarios.atualizar(&ator, id, body).await?,
    ))
}

pub async fn status_funcionario(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(body): Json<AtivoInput>,
) -> Result<Json<Funcionario>, AppError> {
    Ok(Json(
        s.services
            .funcionarios
            .definir_ativo(&ator, id, body.ativo)
            .await?,
    ))
}
