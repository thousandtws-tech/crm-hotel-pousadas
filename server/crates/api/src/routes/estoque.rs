//! Estoque: categorias, itens e movimentações em lote.

use crate::error::ApiError as AppError;
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use clarituz_application::actor::Ator;
use clarituz_application::dto::{
    AtivoInput, ConversaoInput, FichaItemInput, ItemEstoqueInput, ItemEstoqueUpdate, Mensagem,
    MovimentacoesRequest, NfeImportRequest, NfePreview, NfePreviewRequest, NomeInput,
};
use clarituz_domain::entities::{
    CategoriaEstoque, ConversaoUnidade, FichaTecnica, ItemEstoque, NfeImport,
};
use clarituz_domain::queries::{EstoqueBaixoView, FichaItemView, MovimentoView};
use clarituz_shared::{Page, PageParams};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Debug, Deserialize)]
pub struct AtivosPageQuery {
    #[serde(flatten)]
    pub page: PageParams,
    #[serde(default)]
    pub apenas_ativos: bool,
}

#[derive(Debug, Deserialize)]
pub struct AtivosQuery {
    #[serde(default)]
    pub apenas_ativos: bool,
}

// ---------------------------------------------------------------------------
// categorias
// ---------------------------------------------------------------------------

pub async fn listar_categorias(
    State(s): State<AppState>,
    _ator: Ator,
    Query(q): Query<AtivosQuery>,
) -> Result<Json<Vec<CategoriaEstoque>>, AppError> {
    Ok(Json(
        s.services
            .estoque
            .listar_categorias(q.apenas_ativos)
            .await?,
    ))
}

pub async fn criar_categoria(
    State(s): State<AppState>,
    ator: Ator,
    Json(body): Json<NomeInput>,
) -> Result<(StatusCode, Json<CategoriaEstoque>), AppError> {
    let c = s.services.estoque.criar_categoria(&ator, body).await?;
    Ok((StatusCode::CREATED, Json(c)))
}

pub async fn status_categoria(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(body): Json<AtivoInput>,
) -> Result<Json<CategoriaEstoque>, AppError> {
    Ok(Json(
        s.services
            .estoque
            .status_categoria(&ator, id, body.ativo)
            .await?,
    ))
}

pub async fn remover_categoria(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<Mensagem>, AppError> {
    s.services.estoque.remover_categoria(&ator, id).await?;
    Ok(Json(Mensagem::ok("Categoria removida.")))
}

// ---------------------------------------------------------------------------
// itens
// ---------------------------------------------------------------------------

pub async fn listar_itens(
    State(s): State<AppState>,
    _ator: Ator,
    Query(q): Query<AtivosPageQuery>,
) -> Result<Json<Page<ItemEstoque>>, AppError> {
    Ok(Json(
        s.services
            .estoque
            .listar_itens(q.apenas_ativos, q.page)
            .await?,
    ))
}

pub async fn buscar_item(
    State(s): State<AppState>,
    _ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<ItemEstoque>, AppError> {
    Ok(Json(s.services.estoque.buscar_item(id).await?))
}

pub async fn criar_item(
    State(s): State<AppState>,
    ator: Ator,
    Json(body): Json<ItemEstoqueInput>,
) -> Result<(StatusCode, Json<ItemEstoque>), AppError> {
    let i = s.services.estoque.criar_item(&ator, body).await?;
    Ok((StatusCode::CREATED, Json(i)))
}

pub async fn atualizar_item(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(body): Json<ItemEstoqueUpdate>,
) -> Result<Json<ItemEstoque>, AppError> {
    Ok(Json(
        s.services.estoque.atualizar_item(&ator, id, body).await?,
    ))
}

pub async fn status_item(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(body): Json<AtivoInput>,
) -> Result<Json<ItemEstoque>, AppError> {
    Ok(Json(
        s.services
            .estoque
            .status_item(&ator, id, body.ativo)
            .await?,
    ))
}

/// Reimprime a etiqueta do item na impressora dedicada (agente local).
pub async fn imprimir_etiqueta(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<Value>, AppError> {
    s.services.estoque.imprimir_etiqueta(&ator, id).await?;
    Ok(Json(json!({"mensagem": "Etiqueta enviada para a fila."})))
}

pub async fn remover_item(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<Mensagem>, AppError> {
    s.services.estoque.remover_item(&ator, id).await?;
    Ok(Json(Mensagem::ok("Item removido do estoque.")))
}

// ---------------------------------------------------------------------------
// movimentações
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct MovimentosQuery {
    #[serde(flatten)]
    pub page: PageParams,
    pub iditem: Option<i64>,
}

/// Entradas/saídas em lote — uma transação (`gEntrada.php`/`gSaida.php`).
pub async fn movimentar(
    State(s): State<AppState>,
    ator: Ator,
    Json(body): Json<MovimentacoesRequest>,
) -> Result<Json<Mensagem>, AppError> {
    let n = s.services.estoque.movimentar(&ator, body).await?;
    Ok(Json(Mensagem::ok(format!(
        "{n} movimentação(ões) aplicadas."
    ))))
}

pub async fn listar_movimentos(
    State(s): State<AppState>,
    _ator: Ator,
    Query(q): Query<MovimentosQuery>,
) -> Result<Json<Page<MovimentoView>>, AppError> {
    Ok(Json(
        s.services
            .estoque
            .listar_movimentos(q.iditem, q.page)
            .await?,
    ))
}

// ---------------------------------------------------------------------------
// ficha técnica / conversões / alertas / NF-e
// ---------------------------------------------------------------------------

pub async fn listar_ficha(
    State(s): State<AppState>,
    _ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<Vec<FichaItemView>>, AppError> {
    Ok(Json(s.services.estoque.listar_ficha(id).await?))
}

pub async fn salvar_ficha_item(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(body): Json<FichaItemInput>,
) -> Result<Json<FichaTecnica>, AppError> {
    Ok(Json(
        s.services
            .estoque
            .salvar_ficha_item(&ator, id, body)
            .await?,
    ))
}

pub async fn remover_ficha_item(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<Mensagem>, AppError> {
    s.services.estoque.remover_ficha_item(&ator, id).await?;
    Ok(Json(Mensagem::ok("Item removido da ficha técnica.")))
}

pub async fn listar_conversoes(
    State(s): State<AppState>,
    _ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<Vec<ConversaoUnidade>>, AppError> {
    Ok(Json(s.services.estoque.listar_conversoes(id).await?))
}

pub async fn salvar_conversao(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(body): Json<ConversaoInput>,
) -> Result<Json<ConversaoUnidade>, AppError> {
    Ok(Json(
        s.services.estoque.salvar_conversao(&ator, id, body).await?,
    ))
}

pub async fn remover_conversao(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<Mensagem>, AppError> {
    s.services.estoque.remover_conversao(&ator, id).await?;
    Ok(Json(Mensagem::ok("Conversão removida.")))
}

/// Alertas de estoque mínimo — itens ativos com quantidade <= mínimo.
pub async fn alertas_minimo(
    State(s): State<AppState>,
    _ator: Ator,
) -> Result<Json<Vec<EstoqueBaixoView>>, AppError> {
    Ok(Json(s.services.estoque.alertas_minimo().await?))
}

/// Lê o XML da NF-e e devolve a prévia — nada persiste.
pub async fn preview_nfe(
    State(s): State<AppState>,
    _ator: Ator,
    Json(body): Json<NfePreviewRequest>,
) -> Result<Json<NfePreview>, AppError> {
    Ok(Json(s.services.estoque.preview_nfe(body).await?))
}

/// Confirma a importação — tx única: entradas + movimentos + a pagar.
pub async fn importar_nfe(
    State(s): State<AppState>,
    ator: Ator,
    Json(body): Json<NfeImportRequest>,
) -> Result<Json<NfeImport>, AppError> {
    Ok(Json(s.services.estoque.importar_nfe(&ator, body).await?))
}
