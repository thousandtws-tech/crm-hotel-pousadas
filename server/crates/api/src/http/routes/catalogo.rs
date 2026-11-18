use crate::http::error::ApiError as AppError;
use crate::http::state::AppState;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use clarituz_application::actor::Ator;
use clarituz_application::dto::{
    AcomodacaoInput, AtivoInput, EnderecoInput, EstabelecimentoInput, FrigobarInput,
    ItemFrigobarInput, Mensagem, NomeInput, QuantidadeInput, QuartoInput, TarifaOcupacaoInput,
    VagaInput, VinculoAcomodacaoInput,
};
use clarituz_domain::entities::{
    Acomodacao, EnderecoEstabelecimento, Estabelecimento, FormaPagamento, Frigobar, ItemFrigobar,
    Quarto, TarifaHistorico, TarifaOcupacao, TipoAcomodacao, VagaEstacionamento,
};
use clarituz_domain::queries::ItemFrigobarView;
use clarituz_domain::DomainError;
use clarituz_shared::{Page, PageParams};
use serde::Deserialize;

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

pub async fn tarifas_ocupacao(
    State(s): State<AppState>,
    _ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<Vec<TarifaOcupacao>>, AppError> {
    Ok(Json(s.services.acomodacoes.tarifas_ocupacao(id).await?))
}

pub async fn salvar_tarifas_ocupacao(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(body): Json<Vec<TarifaOcupacaoInput>>,
) -> Result<Json<Vec<TarifaOcupacao>>, AppError> {
    Ok(Json(
        s.services
            .acomodacoes
            .salvar_tarifas_ocupacao(&ator, id, body)
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

pub async fn remover_tipo(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<Mensagem>, AppError> {
    s.services.acomodacoes.remover_tipo(&ator, id).await?;
    Ok(Json(Mensagem::ok("Tipo de acomodação removido.")))
}

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

pub async fn remover_acomodacao(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<Mensagem>, AppError> {
    let chaves = s.services.acomodacoes.remover(&ator, id).await?;
    for k in chaves {
        s.store.delete(&k).await.ok();
    }
    Ok(Json(Mensagem::ok("Acomodação removida.")))
}

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

pub async fn remover_quarto(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<Mensagem>, AppError> {
    s.services.acomodacoes.remover_quarto(&ator, id).await?;
    Ok(Json(Mensagem::ok("Quarto removido.")))
}

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

pub async fn remover_frigobar(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<Mensagem>, AppError> {
    s.services.frigobar.remover(&ator, id).await?;
    Ok(Json(Mensagem::ok("Frigobar removido.")))
}

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

pub async fn remover_pagamento(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<Mensagem>, AppError> {
    s.services.pagamentos.remover(&ator, id).await?;
    Ok(Json(Mensagem::ok("Forma de pagamento removida.")))
}

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
    let ext = content_type.strip_prefix("image/").map_or_else(
        || "bin".into(),
        |e| e.replace("jpeg", "jpg").replace("svg+xml", "svg"),
    );
    let nome = format!("logo.{ext}");
    let key = format!("logo/{nome}");

    s.store.put(&key, &body, content_type).await?;

    s.services
        .estabelecimento
        .definir_logo(&ator, &nome, &key)
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
    let bytes =
        s.store.get(&caminho).await?.ok_or_else(|| {
            DomainError::nao_encontrado("Arquivo de logo não encontrado no storage.")
        })?;
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
