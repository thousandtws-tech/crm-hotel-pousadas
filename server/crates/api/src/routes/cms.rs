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
use clarituz_domain::entities::{
    AcomodacaoCms, AcomodacaoCmsView, AcomodacaoMidia, AcomodacaoPublica,
};
use clarituz_domain::events::{Aviso, EventoApp, TipoAviso};
use clarituz_domain::DomainError;
use serde::{Deserialize, Serialize};
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
    Ok(Json(
        s.services.cms.publicar(&ator, id, input.publicar).await?,
    ))
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

    let key = format!("cms/{id}/{}.{ext}", uuid_simple());
    s.store.put(&key, &body, &content_type).await?;

    let midia = s
        .services
        .cms
        .adicionar_midia(&ator, id, tipo, &key, &content_type)
        .await?;
    Ok((StatusCode::CREATED, Json(midia)))
}

/// `DELETE /cms/midia/{id}` — remove metadado + objeto.
pub async fn remover_midia(
    State(s): State<AppState>,
    ator: Ator,
    Path(id): Path<i64>,
) -> Result<StatusCode, AppError> {
    let anterior = s.services.cms.remover_midia(&ator, id).await?;
    if let Some(c) = anterior {
        s.store.delete(&c).await.ok();
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
    let Some((key, mime, publicado)) = s.services.cms.caminho_midia(id).await? else {
        return Err(DomainError::nao_encontrado("Mídia não encontrada.").into());
    };
    if !publicado {
        return Err(DomainError::nao_encontrado("Mídia não encontrada.").into());
    }
    servir_objeto(&s, &key, &mime).await
}

/// `GET /cms/midia/{id}/arquivo` — preview autenticado (enxerga rascunho).
pub async fn servir_midia_admin(
    State(s): State<AppState>,
    _ator: Ator,
    Path(id): Path<i64>,
) -> Result<([(HeaderName, String); 2], Vec<u8>), AppError> {
    let Some((key, mime, _)) = s.services.cms.caminho_midia(id).await? else {
        return Err(DomainError::nao_encontrado("Mídia não encontrada.").into());
    };
    servir_objeto(&s, &key, &mime).await
}

async fn servir_objeto(
    s: &AppState,
    key: &str,
    mime: &str,
) -> Result<([(HeaderName, String); 2], Vec<u8>), AppError> {
    let bytes = s
        .store
        .get(key)
        .await?
        .ok_or_else(|| DomainError::nao_encontrado("Arquivo não encontrado no storage."))?;
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
        Err(BroadcastStreamRecvError::Lagged(_)) => Some(Ok(Event::default().comment("lagged"))),
    });

    Sse::new(eventos).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("ping"),
    )
}

// ---------------------------------------------------------------------------
// público — reserva online pelo site (com notificação Realtime para o Admin)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct ReservaPublicaInput {
    pub slug: Option<String>,
    pub idacomodacao: Option<i64>,
    pub check_in: chrono::NaiveDate,
    pub check_out: chrono::NaiveDate,
    pub hospedes: i32,
    pub nome: String,
    pub email: String,
    pub telefone: String,
    pub cpf: Option<String>,
    pub observacoes: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ReservaPublicaOutput {
    pub ok: bool,
    pub status: &'static str,
    pub idreserva: Option<i64>,
    pub idcliente: i64,
    pub mensagem: String,
}

/// `POST /publico/reservas` — registra o cliente + cria a reserva pendente
/// (ou registra solicitação se o período estiver ocupado) e dispara `Aviso`
/// imediato no `EventBus` (SSE + inbox `notificacao`) para toda a equipe.
pub async fn publico_criar_reserva(
    State(s): State<AppState>,
    Json(input): Json<ReservaPublicaInput>,
) -> Result<(StatusCode, Json<ReservaPublicaOutput>), AppError> {
    let nome = input.nome.trim();
    let email = input.email.trim().to_lowercase();
    let telefone = input.telefone.trim();

    if nome.is_empty() || email.is_empty() || telefone.is_empty() {
        return Err(DomainError::validacao("Informe nome, e-mail e telefone.").into());
    }
    if input.check_out < input.check_in {
        return Err(DomainError::validacao(
            "A data de check-out deve ser igual ou posterior ao check-in.",
        )
        .into());
    }

    // 1. Resolve a acomodação pelo id ou pelo slug do CMS (ou fallback para a primeira ativa)
    let acom_row: Option<(i64, String, i32, rust_decimal::Decimal, i32)> =
        if let Some(id) = input.idacomodacao {
            sqlx::query_as(
            "SELECT id, nome, numero, valor, capacidade FROM acomodacao WHERE id = $1 AND ativo",
        )
        .bind(id)
        .fetch_optional(&s.pool)
        .await
        .map_err(|_| DomainError::Infra)?
        } else if let Some(slug) = input.slug.as_deref().filter(|s| !s.trim().is_empty()) {
            sqlx::query_as(
                "SELECT a.id, a.nome, a.numero, a.valor, a.capacidade
             FROM acomodacao a
             JOIN acomodacao_cms c ON c.idacomodacao = a.id
             WHERE c.slug = $1 AND a.ativo
             LIMIT 1",
            )
            .bind(slug.trim())
            .fetch_optional(&s.pool)
            .await
            .map_err(|_| DomainError::Infra)?
        } else {
            None
        };

    let (idacomodacao, acom_nome, acom_num, valor_diaria, acom_cap) = match acom_row {
        Some(r) => r,
        None => sqlx::query_as(
            "SELECT id, nome, numero, valor, capacidade FROM acomodacao WHERE ativo ORDER BY numero LIMIT 1",
        )
        .fetch_optional(&s.pool)
        .await
        .map_err(|_| DomainError::Infra)?
        .ok_or_else(|| DomainError::nao_encontrado("Nenhuma acomodação ativa encontrada."))?,
    };

    let hospedes = input.hospedes.clamp(1, acom_cap.max(1));

    // 2. Localiza ou cria o cliente pelo e-mail/CPF
    let cpf_limpo: Option<String> = input
        .cpf
        .as_deref()
        .map(|c| {
            c.chars()
                .filter(|ch| ch.is_ascii_digit())
                .collect::<String>()
        })
        .filter(|c| c.len() >= 11);

    let cliente_existente: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM cliente
         WHERE LOWER(email) = $1 OR ($2::text IS NOT NULL AND cpf = $2)
         LIMIT 1",
    )
    .bind(&email)
    .bind(&cpf_limpo)
    .fetch_optional(&s.pool)
    .await
    .map_err(|_| DomainError::Infra)?;

    let idcliente = if let Some(cid) = cliente_existente {
        let _ = sqlx::query(
            "UPDATE cliente SET nome = $2, telefone = $3, atualizado_em = now() WHERE id = $1",
        )
        .bind(cid)
        .bind(nome)
        .bind(telefone)
        .execute(&s.pool)
        .await;
        cid
    } else {
        let cpf_gerado = cpf_limpo.unwrap_or_else(|| {
            let digitos: String = telefone.chars().filter(|c| c.is_ascii_digit()).collect();
            let sufixo = &uuid_simple()[..6];
            format!("SITE-{digitos}-{sufixo}")
        });
        sqlx::query_scalar::<_, i64>(
            "INSERT INTO cliente (nome, cpf, data_nascimento, email, telefone, ativo)
             VALUES ($1, $2, DATE '1990-01-01', $3, $4, TRUE)
             RETURNING id",
        )
        .bind(nome)
        .bind(&cpf_gerado)
        .bind(&email)
        .bind(telefone)
        .fetch_one(&s.pool)
        .await
        .map_err(|_| DomainError::Infra)?
    };

    // 3. Calcula diárias e tenta gravar a reserva pendente ('p')
    let dias = (input.check_out - input.check_in).num_days().max(1);
    let valor_total = valor_diaria * rust_decimal::Decimal::from(dias);
    let obs_final = match input
        .observacoes
        .as_deref()
        .map(str::trim)
        .filter(|o| !o.is_empty())
    {
        Some(o) => format!("[Site] Tel: {telefone} | E-mail: {email} | Obs: {o}"),
        None => format!("[Reserva pelo Site] Tel: {telefone} | E-mail: {email}"),
    };

    let mut tx = s.pool.begin().await.map_err(|_| DomainError::Infra)?;
    let insert_res = sqlx::query_scalar::<_, i64>(
        "INSERT INTO reserva
            (idacomodacao, idcliente, quantidade_hospedes, entradaprevista, saidaprevista, obs, status, valordiaria)
         VALUES ($1, $2, $3, $4, $5, $6, 'p', $7)
         RETURNING id",
    )
    .bind(idacomodacao)
    .bind(idcliente)
    .bind(hospedes)
    .bind(input.check_in)
    .bind(input.check_out)
    .bind(&obs_final)
    .bind(valor_diaria)
    .fetch_one(&mut *tx)
    .await;

    match insert_res {
        Ok(idreserva) => {
            sqlx::query(
                "INSERT INTO consumo (idreserva, valor_estadia, status) VALUES ($1, $2, 'pendente')",
            )
            .bind(idreserva)
            .bind(valor_total)
            .execute(&mut *tx)
            .await
            .map_err(|_| DomainError::Infra)?;

            tx.commit().await.map_err(|_| DomainError::Infra)?;

            s.eventos.publicar(EventoApp::Aviso(
                Aviso::novo(
                    TipoAviso::Sucesso,
                    format!("Nova reserva pelo site — #{acom_num} {acom_nome}"),
                    format!(
                        "{nome} ({telefone}) reservou de {} a {} para {hospedes} hóspede(s).",
                        input.check_in.format("%d/%m/%Y"),
                        input.check_out.format("%d/%m/%Y")
                    ),
                )
                .dados(serde_json::json!({
                    "idreserva": idreserva,
                    "idcliente": idcliente,
                    "idacomodacao": idacomodacao,
                    "origem": "site",
                })),
            ));

            Ok((
                StatusCode::CREATED,
                Json(ReservaPublicaOutput {
                    ok: true,
                    status: "reserva_criada",
                    idreserva: Some(idreserva),
                    idcliente,
                    mensagem: format!(
                        "Reserva Nº #{idreserva} registrada com sucesso! Nossa recepção já foi notificada em tempo real."
                    ),
                }),
            ))
        }
        Err(_) => {
            let _ = tx.rollback().await;

            // Mesmo com conflito de datas no quarto escolhido, notifica a recepção em tempo real
            s.eventos.publicar(EventoApp::Aviso(
                Aviso::novo(
                    TipoAviso::Alerta,
                    format!("Consulta pelo site (período ocupado) — #{acom_num} {acom_nome}"),
                    format!(
                        "{nome} ({telefone} / {email}) pediu {} a {} ({hospedes} hóspede(s)) — quarto já possui reserva no período.",
                        input.check_in.format("%d/%m/%Y"),
                        input.check_out.format("%d/%m/%Y")
                    ),
                )
                .dados(serde_json::json!({
                    "idcliente": idcliente,
                    "idacomodacao": idacomodacao,
                    "origem": "site_conflito",
                })),
            ));

            Ok((
                StatusCode::CREATED,
                Json(ReservaPublicaOutput {
                    ok: true,
                    status: "consulta_registrada",
                    idreserva: None,
                    idcliente,
                    mensagem: "Sua solicitação foi enviada em tempo real para a recepção! Como este quarto já possui bloqueio em parte das datas escolhidas, nossa equipe entrará em contato para confirmar a melhor opção.".into(),
                }),
            ))
        }
    }
}
