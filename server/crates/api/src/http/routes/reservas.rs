//! Reservas: ciclo de vida completo — criar, listar, disponibilidade,
//! calendário, check-in, check-out, cancelamento e consumo.

use crate::http::error::ApiError as AppError;
use crate::http::state::AppState;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use chrono::NaiveDate;
use clarituz_application::actor::Ator;
use clarituz_application::dto::{
    AcompanhanteInput, AdicionalInput, CancelamentoResponse, CancelarReservaRequest,
    CheckinRequest, CheckoutRequest, DisponibilidadeQuery, DisponibilidadeResponse,
    FnrhEmitRequest, GrupoInput, ItemConsumidoRequest, NoShowRequest, RemanejarInput,
    ReservaFiltroQuery, ReservaInput,
};
use clarituz_domain::entities::{
    Acompanhante, AdicionalConsumo, Fnrh, ItemConsumido, ItemFila, Reserva,
};
use clarituz_domain::enums::StatusReserva;
use clarituz_domain::ports::FiltroReserva;
use clarituz_domain::queries::{ComprovanteResumo, ReservaDetalhe, ReservaResumo};
use clarituz_domain::value_objects::PeriodoEstadia;
use clarituz_domain::DomainError;
use clarituz_shared::{Page, PageParams};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Debug, Deserialize)]
pub struct ListarQuery {
    #[serde(flatten)]
    pub page: PageParams,
    #[serde(flatten)]
    pub filtro: ReservaFiltroQuery,
}

fn parse_status(s: &str) -> Result<StatusReserva, AppError> {
    match s {
        "p" | "pendente" => Ok(StatusReserva::Pendente),
        "i" | "iniciada" => Ok(StatusReserva::Iniciada),
        "c" | "cancelada" => Ok(StatusReserva::Cancelada),
        "f" | "finalizada" => Ok(StatusReserva::Finalizada),
        _ => Err(DomainError::validacao(format!("Status de reserva inválido: '{s}'.")).into()),
    }
}

fn periodo_opt(
    inicio: Option<NaiveDate>,
    fim: Option<NaiveDate>,
) -> Result<Option<PeriodoEstadia>, AppError> {
    match (inicio, fim) {
        (Some(i), Some(f)) => Ok(Some(PeriodoEstadia::new(i, f)?)),
        (None, None) => Ok(None),
        _ => Err(DomainError::validacao("Informe inicio e fim juntos.").into()),
    }
}

pub async fn listar_reservas(
    State(s): State<AppState>,
    _ator: Ator,
    Query(q): Query<ListarQuery>,
) -> Result<Json<Page<ReservaResumo>>, AppError> {
    let filtro = FiltroReserva {
        periodo: periodo_opt(q.filtro.inicio, q.filtro.fim)?,
        status: q
            .filtro
            .status
            .as_deref()
            .map(|s| parse_status(&s.to_lowercase()))
            .transpose()?,
        idacomodacao: q.filtro.idacomodacao,
        idcliente: q.filtro.idcliente,
        busca: q.filtro.busca.filter(|b| !b.trim().is_empty()),
    };
    Ok(Json(s.services.reservas.listar(filtro, q.page).await?))
}

pub async fn buscar_reserva(
    State(s): State<AppState>,
    _ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<ReservaDetalhe>, AppError> {
    Ok(Json(s.services.reservas.detalhe(id).await?))
}

pub async fn criar_reserva(
    State(s): State<AppState>,
    ator: Ator,
    Json(body): Json<ReservaInput>,
) -> Result<(StatusCode, Json<Reserva>), AppError> {
    let r = s.services.reservas.criar(&ator, body).await?;
    Ok((StatusCode::CREATED, Json(r)))
}

/// Legado: `reserva/api/disponibilidade.php`.
pub async fn disponibilidade(
    State(s): State<AppState>,
    _ator: Ator,
    Query(q): Query<DisponibilidadeQuery>,
) -> Result<Json<DisponibilidadeResponse>, AppError> {
    Ok(Json(
        s.services
            .reservas
            .disponibilidade(
                q.inicio,
                q.fim,
                q.idacomodacao,
                q.excluir_reserva,
                q.hospedes,
            )
            .await?,
    ))
}

/// Eventos do calendário — todas as reservas que intersectam o período.
#[derive(Debug, Deserialize)]
pub struct EventosQuery {
    pub inicio: Option<NaiveDate>,
    pub fim: Option<NaiveDate>,
}

pub async fn eventos(
    State(s): State<AppState>,
    _ator: Ator,
    Query(q): Query<EventosQuery>,
) -> Result<Json<Vec<ReservaResumo>>, AppError> {
    let periodo = periodo_opt(q.inicio, q.fim)?;
    Ok(Json(s.services.reservas.eventos(periodo).await?))
}

/// Check-in — `data`/`hora` opcionais (default: agora, fuso da pousada).
/// Remaneja reserva pendente (drag no mapa de ocupação): muda acomodação
/// e/ou período recalculando o total. 409 quando já saiu de pendente ou o
/// período destino está ocupado.
pub async fn remanejar_reserva(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(input): Json<RemanejarInput>,
) -> Result<Json<Reserva>, AppError> {
    Ok(Json(s.services.reservas.remanejar(&ator, id, input).await?))
}

pub async fn checkin(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    body: Option<Json<CheckinRequest>>,
) -> Result<Json<Reserva>, AppError> {
    let req = body.map_or_default(|b| b.0);
    Ok(Json(
        s.services
            .reservas
            .checkin(&ator, id, req.instante())
            .await?,
    ))
}

/// Check-out — devolve a reserva finalizada e a conta de consumo fechada.
pub async fn checkout(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(body): Json<CheckoutRequest>,
) -> Result<Json<Value>, AppError> {
    let (reserva, consumo) = s.services.reservas.checkout(&ator, id, body).await?;
    Ok(Json(json!({"reserva": reserva, "consumo": consumo})))
}

/// Cancelamento — reserva em estadia exige admin (direto ou via credenciais
/// `login_admin`/`senha_admin`, paridade com `aCancelarReservaAdm.php`).
pub async fn cancelar(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(body): Json<CancelarReservaRequest>,
) -> Result<Json<CancelamentoResponse>, AppError> {
    Ok(Json(s.services.reservas.cancelar(&ator, id, body).await?))
}

/// `DELETE /reservas/{id}` — exclui reserva pendente ou cancelada junto com
/// a conta de consumo (admin). Iniciadas/finalizadas → use Cancelar.
pub async fn remover_reserva(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
) -> Result<StatusCode, AppError> {
    s.services.reservas.remover(&ator, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

// --- consumo -------------------------------------------------------------

/// Venda de item do frigobar para a conta da reserva (`gItemConsumido.php`).
pub async fn registrar_item(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(body): Json<ItemConsumidoRequest>,
) -> Result<(StatusCode, Json<ItemConsumido>), AppError> {
    let item = s
        .services
        .reservas
        .registrar_item_consumido(&ator, id, body)
        .await?;
    Ok((StatusCode::CREATED, Json(item)))
}

pub async fn itens_consumidos(
    State(s): State<AppState>,
    _ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<Vec<ItemConsumido>>, AppError> {
    Ok(Json(s.services.reservas.itens_consumidos(id).await?))
}

pub async fn adicionais(
    State(s): State<AppState>,
    _ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<Vec<AdicionalConsumo>>, AppError> {
    Ok(Json(s.services.reservas.adicionais(id).await?))
}

/// Lançamento avulso na conta durante a estadia (consumo adicional).
pub async fn lancar_adicional(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(body): Json<AdicionalInput>,
) -> Result<Json<AdicionalConsumo>, AppError> {
    Ok(Json(
        s.services
            .reservas
            .lancar_adicional(&ator, id, body)
            .await?,
    ))
}

// --- comprovantes (página Pagamentos do legado) ------------------------------

pub async fn comprovantes(
    State(s): State<AppState>,
    _ator: Ator,
) -> Result<Json<Vec<ComprovanteResumo>>, AppError> {
    Ok(Json(s.services.reservas.comprovantes().await?))
}

/// Recibo gerado a partir da conta persistida — `inline` para "Visualizar";
/// o frontend força download no "Baixar" via `Content-Disposition` local.
pub async fn comprovante_texto(
    State(s): State<AppState>,
    _ator: Ator,
    Path(id): Path<i64>,
) -> Result<([(axum::http::HeaderName, String); 2], String), AppError> {
    let (nome, texto) = s.services.reservas.comprovante_texto(id).await?;
    Ok((
        [
            (
                axum::http::header::CONTENT_TYPE,
                "text/plain; charset=utf-8".to_string(),
            ),
            (
                axum::http::header::CONTENT_DISPOSITION,
                format!("inline; filename=\"{nome}\""),
            ),
        ],
        texto,
    ))
}

/// Envia o comprovante para a impressora térmica —
/// `?impressora=` força uma impressora específica; sem o parâmetro usa
/// a impressora padrão (ou o fallback legado do estabelecimento).
pub async fn imprimir_comprovante(
    State(s): State<AppState>,
    _ator: Ator,
    Path(id): Path<i64>,
    Query(q): Query<ImpressoraQuery>,
) -> Result<Json<Value>, AppError> {
    s.services
        .reservas
        .imprimir_comprovante(id, q.impressora)
        .await?;
    Ok(Json(
        json!({"mensagem": "Comprovante enviado para a impressora."}),
    ))
}

#[derive(Deserialize)]
pub struct ImpressoraQuery {
    pub impressora: Option<i64>,
}

/// Reimprime os tickets de produção (KOT) do consumo da reserva —
/// um ticket por impressora de setor com apenas os itens dela.
pub async fn imprimir_producao(
    State(s): State<AppState>,
    _ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<Value>, AppError> {
    let tickets = s.services.reservas.imprimir_producao(id).await?;
    Ok(Json(
        json!({"mensagem": format!("{tickets} ticket(s) de produção enviados."), "tickets": tickets}),
    ))
}

// ---------------------------------------------------------------------------
// acompanhantes + FNRH (registro de hóspedes)
// ---------------------------------------------------------------------------

pub async fn acompanhantes(
    State(s): State<AppState>,
    _ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<Vec<Acompanhante>>, AppError> {
    Ok(Json(s.services.reservas.listar_acompanhantes(id).await?))
}

pub async fn adicionar_acompanhante(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(body): Json<AcompanhanteInput>,
) -> Result<(StatusCode, Json<Acompanhante>), AppError> {
    let a = s
        .services
        .reservas
        .adicionar_acompanhante(&ator, id, body)
        .await?;
    Ok((StatusCode::CREATED, Json(a)))
}

pub async fn remover_acompanhante(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
) -> Result<StatusCode, AppError> {
    s.services.reservas.remover_acompanhante(&ator, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Fichas FNRH emitidas para a reserva (mais recente primeiro).
pub async fn fnrh_reserva(
    State(s): State<AppState>,
    _ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<Vec<Fnrh>>, AppError> {
    Ok(Json(s.services.reservas.listar_fnrh(id).await?))
}

/// Emite a FNRH — snapshot imutável de cliente + reserva + acompanhantes.
pub async fn emitir_fnrh(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(body): Json<FnrhEmitRequest>,
) -> Result<(StatusCode, Json<Fnrh>), AppError> {
    let f = s.services.reservas.emitir_fnrh(&ator, id, body).await?;
    Ok((StatusCode::CREATED, Json(f)))
}

/// Pendências do fechamento do dia — no-shows, check-outs e contas abertas.
/// Kommunikationshistorik för reservan — alla fila_envio-poster
/// (e-post/WhatsApp, status, försök, fel) i kronologisk ordning.
pub async fn comunicacoes_reserva(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<Vec<ItemFila>>, AppError> {
    Ok(Json(
        s.services
            .comunicacao
            .comunicacoes_reserva(&ator, id)
            .await?,
    ))
}

/// Manuellt återskick av en kommunikationspost — granskad och
/// hastighetsbegränsad i tjänstelagret; originalet bevaras.
pub async fn reenviar_comunicacao(
    State(s): State<AppState>,
    ator: Ator,
    Path((id, item)): Path<(i64, i64)>,
) -> Result<(StatusCode, Json<ItemFila>), AppError> {
    let ny = s
        .services
        .comunicacao
        .reenviar_comunicacao(&ator, id, item)
        .await?;
    Ok((StatusCode::CREATED, Json(ny)))
}

pub async fn pendencias_fechamento(
    State(s): State<AppState>,
    _ator: Ator,
) -> Result<Json<clarituz_domain::queries::PendenciasFechamento>, AppError> {
    Ok(Json(s.services.reservas.pendencias_fechamento().await?))
}

/// Marca no-show — exige PIN gerencial do estabelecimento além do login.
pub async fn marcar_no_show(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(body): Json<NoShowRequest>,
) -> Result<StatusCode, AppError> {
    s.services
        .reservas
        .marcar_no_show(&ator, id, &body.pin)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Envia o relatório determinístico do fechamento por e-mail à pousada.
pub async fn enviar_relatorio_fechamento(
    State(s): State<AppState>,
    ator: Ator,
) -> Result<StatusCode, AppError> {
    s.services
        .reservas
        .enviar_relatorio_fechamento(&ator)
        .await?;
    Ok(StatusCode::ACCEPTED)
}

/// Exportação SNE/CSV das fichas do período — envio manual ao MTur.
pub async fn exportar_fnrh(
    State(s): State<AppState>,
    _ator: Ator,
    Query(q): Query<std::collections::HashMap<String, String>>,
) -> Result<impl IntoResponse, AppError> {
    let parse = |k: &str| -> Result<chrono::NaiveDate, AppError> {
        chrono::NaiveDate::parse_from_str(&q[k], "%Y-%m-%d")
            .map_err(|_| DomainError::validacao(format!("data '{k}' inválida")).into())
    };
    let csv = s
        .services
        .reservas
        .exportar_fnrh_csv(parse("inicio")?, parse("fim")?)
        .await?;
    Ok((
        StatusCode::OK,
        [
            (axum::http::header::CONTENT_TYPE, "text/csv; charset=utf-8"),
            (
                axum::http::header::CONTENT_DISPOSITION,
                "attachment; filename=fnrh-sne.csv",
            ),
        ],
        csv,
    ))
}

// ---------------------------------------------------------------------------
// Mapa por andar + bloqueio formal
// ---------------------------------------------------------------------------

/// GET /reservas/mapa — visão por pavimento: ocupação, bloqueio, limpeza e manutenção.
pub async fn mapa_quartos(State(s): State<AppState>, _ator: Ator) -> Result<Json<Value>, AppError> {
    Ok(Json(json!(s.services.reservas.mapa_quartos().await?)))
}

#[derive(Debug, Deserialize)]
pub struct PainelRecepcaoQuery {
    /// Dia de referência (YYYY-MM-DD local do front-desk); sem ele usa
    /// o dia UTC do servidor.
    pub data: Option<NaiveDate>,
}

/// GET /reservas/painel-recepcao — chegadas, hóspedes na casa e mapa de
/// quartos do dia em uma única chamada, resolvidas em paralelo no
/// servidor. O front-desk faz 1 request em vez de 3.
pub async fn painel_recepcao(
    State(s): State<AppState>,
    _ator: Ator,
    Query(q): Query<PainelRecepcaoQuery>,
) -> Result<Json<Value>, AppError> {
    let hoje = q.data.unwrap_or_else(|| chrono::Utc::now().date_naive());
    let periodo = Some(PeriodoEstadia::new(hoje, hoje)?);
    let filtro = |status: StatusReserva| FiltroReserva {
        periodo: periodo.clone(),
        status: Some(status),
        idacomodacao: None,
        idcliente: None,
        busca: None,
    };
    let pag = |n: u32| PageParams {
        page: 1,
        per_page: n,
    };
    let (chegadas, na_casa, mapa) = tokio::join!(
        s.services
            .reservas
            .listar(filtro(StatusReserva::Pendente), pag(50)),
        s.services
            .reservas
            .listar(filtro(StatusReserva::Iniciada), pag(100)),
        s.services.reservas.mapa_quartos(),
    );
    Ok(Json(json!({
        "chegadas": chegadas?.items,
        "na_casa": na_casa?.items,
        "mapa": mapa?,
    })))
}

#[derive(Debug, Deserialize)]
pub struct BloqueioInput {
    pub inicio: NaiveDate,
    pub fim: NaiveDate,
    pub motivo: String,
}

/// POST /acomodacoes/{id}/bloqueio — tira a unidade de venda no período.
pub async fn bloquear(
    State(s): State<AppState>,
    ator: Ator,
    Path(idacomodacao): Path<i64>,
    Json(b): Json<BloqueioInput>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(json!(
        s.services
            .reservas
            .bloquear(&ator, idacomodacao, b.inicio, b.fim, &b.motivo)
            .await?
    )))
}

/// GET /bloqueios — bloqueios vigentes e futuros.
pub async fn bloqueios(State(s): State<AppState>, _ator: Ator) -> Result<Json<Value>, AppError> {
    Ok(Json(json!(s.services.reservas.bloqueios().await?)))
}

/// DELETE /bloqueios/{id} — libera a unidade.
pub async fn desbloquear(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
) -> Result<StatusCode, AppError> {
    s.services.reservas.desbloquear(&ator, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Widget "usar no meu site" — link + QR + snippet embed do motor de reservas.
// ---------------------------------------------------------------------------

/// GET /reservas/widget — devolve a URL do motor, o QR (SVG) e o snippet
/// HTML pronto para colar num site externo (mini busca abre em nova aba).
pub async fn widget_motor(State(s): State<AppState>, _ator: Ator) -> Result<Json<Value>, AppError> {
    let url = format!("{}/reservar", s.site_base.trim_end_matches('/'));
    let qr = qrcode::QrCode::new(url.as_bytes())
        .map_err(|e| DomainError::regra(format!("QR inválido: {e}")))?;
    let svg = qr
        .render::<qrcode::render::svg::Color>()
        .min_dimensions(320, 320)
        .quiet_zone(true)
        .build();
    let snippet = format!(
        r#"<!-- Motor de reservas — cole no seu site -->
<form action="{url}" method="get" target="_blank" rel="noopener"
      style="display:flex;gap:8px;flex-wrap:wrap;font-family:sans-serif">
  <input type="date" name="checkIn" required aria-label="Check-in" />
  <input type="date" name="checkOut" required aria-label="Check-out" />
  <input type="number" name="guests" min="1" value="2" aria-label="Hóspedes" style="width:90px" />
  <button type="submit"
          style="background:#1a6f8a;color:#fff;border:0;border-radius:6px;padding:10px 18px;cursor:pointer">
    Reservar agora
  </button>
</form>"#
    );
    Ok(Json(
        json!({ "url": url, "qr_svg": svg, "snippet": snippet }),
    ))
}

// ---------------------------------------------------------------------------
// Grupos / eventos — rooming list + bloqueio em massa + reservas vinculadas.
// ---------------------------------------------------------------------------

/// GET /grupos — todos os grupos.
pub async fn grupos(State(s): State<AppState>, _ator: Ator) -> Result<Json<Value>, AppError> {
    Ok(Json(json!(s.services.reservas.grupos().await?)))
}

/// POST /grupos — cria grupo + rooming list (+ bloqueio em massa opcional).
pub async fn criar_grupo(
    State(s): State<AppState>,
    ator: Ator,
    Json(input): Json<GrupoInput>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let g = s.services.reservas.criar_grupo(&ator, input).await?;
    Ok((StatusCode::CREATED, Json(json!(g))))
}

/// GET /grupos/{id}/unidades — rooming list com hóspede/status por unidade.
pub async fn grupo_unidades(
    State(s): State<AppState>,
    _ator: Ator,
    Path(id): Path<i64>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(json!(s.services.reservas.grupo_unidades(id).await?)))
}

/// DELETE /grupos/{id} — remove grupo; libera bloqueios, desvincula reservas.
pub async fn remover_grupo(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
) -> Result<StatusCode, AppError> {
    s.services.reservas.remover_grupo(&ator, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// PATCH /reservas/{id}/grupo — vincula ({idgrupo: n}) ou desvincula (null).
pub async fn vincular_grupo(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
    Json(b): Json<Value>,
) -> Result<StatusCode, AppError> {
    let idgrupo = b.get("idgrupo").and_then(serde_json::Value::as_i64);
    s.services
        .reservas
        .vincular_reserva_grupo(&ator, id, idgrupo)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
