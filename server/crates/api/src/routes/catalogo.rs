//! Catálogo: tipos de acomodação, acomodações, quartos, estacionamento,
//! frigobares, formas de pagamento e estabelecimento.

use crate::error::ApiError as AppError;
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use clarituz_application::actor::Ator;
use clarituz_application::dto::{
    AcomodacaoInput, AtivoInput, EnderecoInput, EstabelecimentoInput, FrigobarInput,
    ItemFrigobarInput, Mensagem, NomeInput, QuantidadeInput, QuartoInput, VagaInput,
    VinculoAcomodacaoInput,
};
use clarituz_domain::entities::{
    Acomodacao, EnderecoEstabelecimento, Estabelecimento, FormaPagamento, Frigobar, ItemFrigobar,
    Quarto, TarifaHistorico, TipoAcomodacao, VagaEstacionamento,
};
use clarituz_domain::queries::ItemFrigobarView;
use clarituz_domain::DomainError;
use clarituz_shared::{Page, PageParams};
use serde::Deserialize;

// ---------------------------------------------------------------------------
// tipos de acomodação
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct AtivosQuery {
    #[serde(default)]
    pub apenas_ativos: bool,
}

pub async fn listar_tipos(
    State(s): State<AppState>,
    _ator: Ator,
    Query(q): Query<AtivosQuery>,
) -> Result<Json<Vec<TipoAcomodacao>>, AppError> {
    Ok(Json(
        s.services.acomodacoes.listar_tipos(q.apenas_ativos).await?,
    ))
}

pub async fn criar_tipo(
    State(s): State<AppState>,
    ator: Ator,
    Json(body): Json<NomeInput>,
) -> Result<(StatusCode, Json<TipoAcomodacao>), AppError> {
    let t = s.services.acomodacoes.criar_tipo(&ator, body).await?;
    Ok((StatusCode::CREATED, Json(t)))
}

pub async fn atualizar_tipo(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(body): Json<NomeInput>,
) -> Result<Json<TipoAcomodacao>, AppError> {
    Ok(Json(
        s.services
            .acomodacoes
            .atualizar_tipo(&ator, id, body)
            .await?,
    ))
}

pub async fn status_tipo(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(body): Json<AtivoInput>,
) -> Result<Json<TipoAcomodacao>, AppError> {
    Ok(Json(
        s.services
            .acomodacoes
            .status_tipo(&ator, id, body.ativo)
            .await?,
    ))
}

// ---------------------------------------------------------------------------
// acomodações
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct AcomodacoesQuery {
    #[serde(flatten)]
    pub page: PageParams,
    #[serde(default)]
    pub apenas_ativas: bool,
}

pub async fn listar_acomodacoes(
    State(s): State<AppState>,
    _ator: Ator,
    Query(q): Query<AcomodacoesQuery>,
) -> Result<Json<Page<Acomodacao>>, AppError> {
    Ok(Json(
        s.services
            .acomodacoes
            .listar(q.apenas_ativas, q.page)
            .await?,
    ))
}

pub async fn buscar_acomodacao(
    State(s): State<AppState>,
    _ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<Acomodacao>, AppError> {
    Ok(Json(s.services.acomodacoes.buscar(id).await?))
}

pub async fn criar_acomodacao(
    State(s): State<AppState>,
    ator: Ator,
    Json(body): Json<AcomodacaoInput>,
) -> Result<(StatusCode, Json<Acomodacao>), AppError> {
    let a = s.services.acomodacoes.criar(&ator, body).await?;
    Ok((StatusCode::CREATED, Json(a)))
}

pub async fn atualizar_acomodacao(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(body): Json<AcomodacaoInput>,
) -> Result<Json<Acomodacao>, AppError> {
    Ok(Json(
        s.services.acomodacoes.atualizar(&ator, id, body).await?,
    ))
}

pub async fn status_acomodacao(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(body): Json<AtivoInput>,
) -> Result<Json<Acomodacao>, AppError> {
    Ok(Json(
        s.services
            .acomodacoes
            .definir_ativo(&ator, id, body.ativo)
            .await?,
    ))
}

pub async fn tarifas_acomodacao(
    State(s): State<AppState>,
    _ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<Vec<TarifaHistorico>>, AppError> {
    Ok(Json(s.services.acomodacoes.historico_tarifas(id).await?))
}

// ---------------------------------------------------------------------------
// quartos
// ---------------------------------------------------------------------------

pub async fn listar_quartos(
    State(s): State<AppState>,
    _ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<Vec<Quarto>>, AppError> {
    Ok(Json(s.services.acomodacoes.listar_quartos(id).await?))
}

pub async fn criar_quarto(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(body): Json<QuartoInput>,
) -> Result<(StatusCode, Json<Quarto>), AppError> {
    let q = s.services.acomodacoes.criar_quarto(&ator, id, body).await?;
    Ok((StatusCode::CREATED, Json(q)))
}

pub async fn status_quarto(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(body): Json<AtivoInput>,
) -> Result<Json<Quarto>, AppError> {
    Ok(Json(
        s.services
            .acomodacoes
            .status_quarto(&ator, id, body.ativo)
            .await?,
    ))
}

// ---------------------------------------------------------------------------
// estacionamento
// ---------------------------------------------------------------------------

pub async fn listar_vagas(
    State(s): State<AppState>,
    _ator: Ator,
) -> Result<Json<Vec<VagaEstacionamento>>, AppError> {
    Ok(Json(s.services.estacionamento.listar().await?))
}

pub async fn criar_vaga(
    State(s): State<AppState>,
    ator: Ator,
    Json(body): Json<VagaInput>,
) -> Result<(StatusCode, Json<VagaEstacionamento>), AppError> {
    let v = s.services.estacionamento.criar(&ator, body).await?;
    Ok((StatusCode::CREATED, Json(v)))
}

pub async fn vincular_vaga(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(body): Json<VinculoAcomodacaoInput>,
) -> Result<Json<VagaEstacionamento>, AppError> {
    Ok(Json(
        s.services.estacionamento.vincular(&ator, id, body).await?,
    ))
}

pub async fn status_vaga(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(body): Json<AtivoInput>,
) -> Result<Json<VagaEstacionamento>, AppError> {
    Ok(Json(
        s.services
            .estacionamento
            .definir_ativo(&ator, id, body.ativo)
            .await?,
    ))
}

pub async fn remover_vaga(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<Mensagem>, AppError> {
    s.services.estacionamento.remover(&ator, id).await?;
    Ok(Json(Mensagem::ok("Vaga removida.")))
}

// ---------------------------------------------------------------------------
// frigobares
// ---------------------------------------------------------------------------

pub async fn listar_frigobares(
    State(s): State<AppState>,
    _ator: Ator,
) -> Result<Json<Vec<Frigobar>>, AppError> {
    Ok(Json(s.services.frigobar.listar().await?))
}

pub async fn buscar_frigobar(
    State(s): State<AppState>,
    _ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<Frigobar>, AppError> {
    Ok(Json(s.services.frigobar.buscar(id).await?))
}

pub async fn criar_frigobar(
    State(s): State<AppState>,
    ator: Ator,
    Json(body): Json<FrigobarInput>,
) -> Result<(StatusCode, Json<Frigobar>), AppError> {
    let f = s.services.frigobar.criar(&ator, body).await?;
    Ok((StatusCode::CREATED, Json(f)))
}

pub async fn atualizar_frigobar(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(body): Json<FrigobarInput>,
) -> Result<Json<Frigobar>, AppError> {
    Ok(Json(s.services.frigobar.atualizar(&ator, id, body).await?))
}

pub async fn status_frigobar(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(body): Json<AtivoInput>,
) -> Result<Json<Frigobar>, AppError> {
    Ok(Json(
        s.services
            .frigobar
            .definir_ativo(&ator, id, body.ativo)
            .await?,
    ))
}

pub async fn itens_frigobar(
    State(s): State<AppState>,
    _ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<Vec<ItemFrigobarView>>, AppError> {
    Ok(Json(s.services.frigobar.itens(id).await?))
}

pub async fn repor_item_frigobar(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(body): Json<ItemFrigobarInput>,
) -> Result<(StatusCode, Json<ItemFrigobar>), AppError> {
    let item = s.services.frigobar.repor_item(&ator, id, body).await?;
    Ok((StatusCode::CREATED, Json(item)))
}

pub async fn atualizar_item_frigobar(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(body): Json<QuantidadeInput>,
) -> Result<Json<ItemFrigobar>, AppError> {
    Ok(Json(
        s.services.frigobar.ajustar_item(&ator, id, body).await?,
    ))
}

pub async fn status_item_frigobar(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(body): Json<AtivoInput>,
) -> Result<Json<Mensagem>, AppError> {
    s.services
        .frigobar
        .status_item(&ator, id, body.ativo)
        .await?;
    Ok(Json(Mensagem::ok("Status do item atualizado.")))
}

pub async fn remover_item_frigobar(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<Mensagem>, AppError> {
    s.services.frigobar.remover_item(&ator, id).await?;
    Ok(Json(Mensagem::ok("Item removido do frigobar.")))
}

// ---------------------------------------------------------------------------
// formas de pagamento
// ---------------------------------------------------------------------------

pub async fn listar_pagamentos(
    State(s): State<AppState>,
    _ator: Ator,
    Query(q): Query<AtivosQuery>,
) -> Result<Json<Vec<FormaPagamento>>, AppError> {
    Ok(Json(s.services.pagamentos.listar(q.apenas_ativos).await?))
}

pub async fn criar_pagamento(
    State(s): State<AppState>,
    ator: Ator,
    Json(body): Json<NomeInput>,
) -> Result<(StatusCode, Json<FormaPagamento>), AppError> {
    let f = s.services.pagamentos.criar(&ator, body).await?;
    Ok((StatusCode::CREATED, Json(f)))
}

pub async fn atualizar_pagamento(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(body): Json<NomeInput>,
) -> Result<Json<FormaPagamento>, AppError> {
    Ok(Json(
        s.services.pagamentos.atualizar(&ator, id, body).await?,
    ))
}

pub async fn status_pagamento(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(body): Json<AtivoInput>,
) -> Result<Json<FormaPagamento>, AppError> {
    Ok(Json(
        s.services
            .pagamentos
            .definir_ativo(&ator, id, body.ativo)
            .await?,
    ))
}

// ---------------------------------------------------------------------------
// estabelecimento
// ---------------------------------------------------------------------------

pub async fn obter_estabelecimento(
    State(s): State<AppState>,
    _ator: Ator,
) -> Result<Json<Option<Estabelecimento>>, AppError> {
    Ok(Json(s.services.estabelecimento.obter().await?))
}

pub async fn obter_endereco(
    State(s): State<AppState>,
    _ator: Ator,
) -> Result<Json<Option<EnderecoEstabelecimento>>, AppError> {
    Ok(Json(s.services.estabelecimento.obter_endereco().await?))
}

pub async fn salvar_estabelecimento(
    State(s): State<AppState>,
    ator: Ator,
    Json(body): Json<EstabelecimentoInput>,
) -> Result<Json<Estabelecimento>, AppError> {
    Ok(Json(
        s.services.estabelecimento.salvar_dados(&ator, body).await?,
    ))
}

pub async fn salvar_endereco(
    State(s): State<AppState>,
    ator: Ator,
    Json(body): Json<EnderecoInput>,
) -> Result<Json<EnderecoEstabelecimento>, AppError> {
    Ok(Json(
        s.services
            .estabelecimento
            .salvar_endereco(&ator, body)
            .await?,
    ))
}

/// Upload da logo (imagem cruda no body, `Content-Type: image/*`, ≤ 2 MB).
/// Persiste em `storage_dir/logo/` e registra nome+caminho — `mLogo.php`.
pub async fn upload_logo(
    State(s): State<AppState>,
    ator: Ator,
    headers: axum::http::HeaderMap,
    body: axum::body::Bytes,
) -> Result<StatusCode, AppError> {
    let content_type = headers
        .get(axum::http::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if !content_type.starts_with("image/") {
        return Err(DomainError::validacao("Envie uma imagem (png, jpg, webp ou svg).").into());
    }
    if body.is_empty() || body.len() > 2 * 1024 * 1024 {
        return Err(DomainError::validacao("Imagem vazia ou maior que 2 MB.").into());
    }
    let ext = content_type
        .strip_prefix("image/")
        .map(|e| e.replace("jpeg", "jpg").replace("svg+xml", "svg"))
        .unwrap_or_else(|| "bin".into());
    let nome = format!("logo.{ext}");

    let dir = std::path::Path::new(&s.storage_dir).join("logo");
    std::fs::create_dir_all(&dir).ok();
    let path = dir.join(&nome);
    std::fs::write(&path, &body).map_err(|_| DomainError::Infra)?;

    s.services
        .estabelecimento
        .definir_logo(&ator, &nome, &path.to_string_lossy())
        .await?;
    Ok(StatusCode::CREATED)
}

/// Serve a logo atual — `404` quando não configurada.
pub async fn logo(
    State(s): State<AppState>,
) -> Result<([(axum::http::HeaderName, String); 2], Vec<u8>), AppError> {
    let Some((_nome, caminho)) = s.services.estabelecimento.logo_atual().await? else {
        return Err(DomainError::nao_encontrado("Logo não configurada.").into());
    };
    let bytes = std::fs::read(&caminho)
        .map_err(|_| DomainError::nao_encontrado("Arquivo de logo não encontrado no storage."))?;
    let mime = match caminho.rsplit('.').next() {
        Some("png") => "image/png",
        Some("jpg") => "image/jpeg",
        Some("svg") => "image/svg+xml",
        Some("webp") => "image/webp",
        _ => "application/octet-stream",
    };
    Ok((
        [
            (axum::http::header::CONTENT_TYPE, mime.to_string()),
            (
                axum::http::header::CACHE_CONTROL,
                "public, max-age=300".into(),
            ),
        ],
        bytes,
    ))
}
