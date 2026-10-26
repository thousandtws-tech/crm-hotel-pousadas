//! Árvore de rotas `/api/v1` + middlewares de observabilidade e robustez.

use crate::routes;
use crate::state::AppState;
use axum::extract::State;
use axum::routing::{delete, get, patch, post, put};
use axum::Json;
use axum::Router;
use serde_json::json;
use std::time::Duration;
use tower_http::cors::CorsLayer;
use tower_http::request_id::{PropagateRequestIdLayer, SetRequestIdLayer};
use tower_http::timeout::TimeoutLayer;
use tower_http::trace::TraceLayer;

async fn healthz() -> Json<serde_json::Value> {
    Json(json!({"status": "ok"}))
}

async fn readyz(State(s): State<AppState>) -> (axum::http::StatusCode, Json<serde_json::Value>) {
    match sqlx::query("SELECT 1").execute(&s.pool).await {
        Ok(_) => (axum::http::StatusCode::OK, Json(json!({"status": "ready"}))),
        Err(_) => (
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"status": "degraded"})),
        ),
    }
}

pub fn build(state: AppState) -> Router {
    let api: Router<AppState> = Router::new()
        // auth — login/refresh públicos
        .route("/auth/login", post(routes::auth::login))
        .route("/auth/register", post(routes::auth::register))
        .route("/auth/refresh", post(routes::auth::refresh))
        .route("/auth/logout", post(routes::auth::logout))
        .route("/auth/me", get(routes::auth::me))
        // clientes
        .route(
            "/clientes",
            get(routes::pessoas::listar_clientes).post(routes::pessoas::criar_cliente),
        )
        .route(
            "/clientes/{id}",
            get(routes::pessoas::buscar_cliente).put(routes::pessoas::atualizar_cliente),
        )
        .route(
            "/clientes/{id}/status",
            patch(routes::pessoas::status_cliente),
        )
        .route(
            "/clientes/{id}/foto",
            put(routes::pessoas::upload_foto_cliente)
                .get(routes::pessoas::foto_cliente)
                .delete(routes::pessoas::remover_foto_cliente),
        )
        // documentos de identidade do cliente
        .route(
            "/clientes/{id}/documentos",
            get(routes::pessoas::listar_documentos).post(routes::pessoas::criar_documento),
        )
        .route(
            "/clientes/{id}/fnrh",
            get(routes::pessoas::fnrh_cliente),
        )
        .route(
            "/documentos/{id}",
            put(routes::pessoas::atualizar_documento).delete(routes::pessoas::remover_documento),
        )
        .route(
            "/documentos/{id}/scan",
            put(routes::pessoas::upload_scan_documento)
                .get(routes::pessoas::scan_documento)
                .delete(routes::pessoas::remover_scan_documento),
        )
        // funcionários (admin)
        .route(
            "/funcionarios",
            get(routes::pessoas::listar_funcionarios).post(routes::pessoas::criar_funcionario),
        )
        .route(
            "/funcionarios/{id}",
            get(routes::pessoas::buscar_funcionario).put(routes::pessoas::atualizar_funcionario),
        )
        .route(
            "/funcionarios/{id}/status",
            patch(routes::pessoas::status_funcionario),
        )
        // tipos de acomodação
        .route(
            "/tipos-acomodacao",
            get(routes::catalogo::listar_tipos).post(routes::catalogo::criar_tipo),
        )
        .route(
            "/tipos-acomodacao/{id}",
            put(routes::catalogo::atualizar_tipo),
        )
        .route(
            "/tipos-acomodacao/{id}/status",
            patch(routes::catalogo::status_tipo),
        )
        // acomodações
        .route(
            "/acomodacoes",
            get(routes::catalogo::listar_acomodacoes).post(routes::catalogo::criar_acomodacao),
        )
        .route(
            "/acomodacoes/{id}",
            get(routes::catalogo::buscar_acomodacao).put(routes::catalogo::atualizar_acomodacao),
        )
        .route(
            "/acomodacoes/{id}/status",
            patch(routes::catalogo::status_acomodacao),
        )
        .route(
            "/acomodacoes/{id}/tarifas",
            get(routes::catalogo::tarifas_acomodacao),
        )
        .route(
            "/acomodacoes/{id}/quartos",
            get(routes::catalogo::listar_quartos).post(routes::catalogo::criar_quarto),
        )
        .route(
            "/quartos/{id}/status",
            patch(routes::catalogo::status_quarto),
        )
        // reservas
        .route(
            "/reservas",
            get(routes::reservas::listar_reservas).post(routes::reservas::criar_reserva),
        )
        .route(
            "/reservas/disponibilidade",
            get(routes::reservas::disponibilidade),
        )
        .route("/reservas/eventos", get(routes::reservas::eventos))
        .route("/reservas/{id}", get(routes::reservas::buscar_reserva))
        .route("/reservas/{id}/check-in", post(routes::reservas::checkin))
        .route("/reservas/{id}/check-out", post(routes::reservas::checkout))
        .route("/reservas/{id}/cancelar", post(routes::reservas::cancelar))
        .route(
            "/reservas/{id}/itens-consumidos",
            get(routes::reservas::itens_consumidos).post(routes::reservas::registrar_item),
        )
        .route(
            "/reservas/{id}/adicionais",
            get(routes::reservas::adicionais).post(routes::reservas::lancar_adicional),
        )
        .route(
            "/reservas/{id}/consumo/imprimir",
            post(routes::reservas::imprimir_producao),
        )
        // registro de hóspedes: acompanhantes + FNRH
        .route(
            "/reservas/{id}/acompanhantes",
            get(routes::reservas::acompanhantes).post(routes::reservas::adicionar_acompanhante),
        )
        .route(
            "/acompanhantes/{id}",
            delete(routes::reservas::remover_acompanhante),
        )
        .route(
            "/reservas/{id}/fnrh",
            get(routes::reservas::fnrh_reserva).post(routes::reservas::emitir_fnrh),
        )
        // estoque
        .route(
            "/estoque/categorias",
            get(routes::estoque::listar_categorias).post(routes::estoque::criar_categoria),
        )
        .route(
            "/estoque/categorias/{id}/status",
            patch(routes::estoque::status_categoria),
        )
        .route(
            "/estoque/categorias/{id}/impressora",
            patch(routes::impressoras::rota_categoria),
        )
        .route(
            "/estoque/itens",
            get(routes::estoque::listar_itens).post(routes::estoque::criar_item),
        )
        .route(
            "/estoque/itens/{id}",
            get(routes::estoque::buscar_item).put(routes::estoque::atualizar_item),
        )
        .route(
            "/estoque/itens/{id}/status",
            patch(routes::estoque::status_item),
        )
        .route(
            "/estoque/movimentacoes",
            get(routes::estoque::listar_movimentos).post(routes::estoque::movimentar),
        )
        // frigobares
        .route(
            "/frigobares",
            get(routes::catalogo::listar_frigobares).post(routes::catalogo::criar_frigobar),
        )
        .route(
            "/frigobares/{id}",
            get(routes::catalogo::buscar_frigobar).put(routes::catalogo::atualizar_frigobar),
        )
        .route(
            "/frigobares/{id}/status",
            patch(routes::catalogo::status_frigobar),
        )
        .route(
            "/frigobares/{id}/itens",
            get(routes::catalogo::itens_frigobar).post(routes::catalogo::repor_item_frigobar),
        )
        .route(
            "/frigobares/itens/{id}",
            put(routes::catalogo::atualizar_item_frigobar)
                .delete(routes::catalogo::remover_item_frigobar),
        )
        .route(
            "/frigobares/itens/{id}/status",
            patch(routes::catalogo::status_item_frigobar),
        )
        // estacionamento
        .route(
            "/estacionamento",
            get(routes::catalogo::listar_vagas).post(routes::catalogo::criar_vaga),
        )
        .route(
            "/estacionamento/{id}",
            delete(routes::catalogo::remover_vaga),
        )
        .route(
            "/estacionamento/{id}/vinculo",
            patch(routes::catalogo::vincular_vaga),
        )
        .route(
            "/estacionamento/{id}/status",
            patch(routes::catalogo::status_vaga),
        )
        // formas de pagamento + comprovantes
        .route(
            "/formas-pagamento",
            get(routes::catalogo::listar_pagamentos).post(routes::catalogo::criar_pagamento),
        )
        .route(
            "/pagamentos/comprovantes",
            get(routes::reservas::comprovantes),
        )
        .route(
            "/pagamentos/comprovantes/{id}",
            get(routes::reservas::comprovante_texto),
        )
        .route(
            "/pagamentos/comprovantes/{id}/imprimir",
            post(routes::reservas::imprimir_comprovante),
        )
        .route(
            "/formas-pagamento/{id}",
            put(routes::catalogo::atualizar_pagamento),
        )
        .route(
            "/formas-pagamento/{id}/status",
            patch(routes::catalogo::status_pagamento),
        )
        // estabelecimento
        .route(
            "/estabelecimento",
            get(routes::catalogo::obter_estabelecimento)
                .put(routes::catalogo::salvar_estabelecimento),
        )
        .route(
            "/estabelecimento/endereco",
            get(routes::catalogo::obter_endereco).put(routes::catalogo::salvar_endereco),
        )
        .route(
            "/estabelecimento/logo",
            post(routes::catalogo::upload_logo).get(routes::catalogo::logo),
        )
        // impressoras de setor (roteamento KOT)
        .route(
            "/impressoras",
            get(routes::impressoras::listar).post(routes::impressoras::criar),
        )
        .route(
            "/impressoras/{id}",
            put(routes::impressoras::atualizar).delete(routes::impressoras::remover),
        )
        .route(
            "/impressoras/{id}/status",
            patch(routes::impressoras::status),
        )
        .route(
            "/impressoras/{id}/testar",
            post(routes::impressoras::testar),
        )
        // financeiro
        .route(
            "/financeiro/resumo",
            get(routes::relatorios::resumo_financeiro),
        )
        .route(
            "/financeiro/series/recebido",
            get(routes::relatorios::serie_recebido),
        )
        .route(
            "/financeiro/series/por-pagamento",
            get(routes::relatorios::serie_por_pagamento),
        )
        .route(
            "/financeiro/series/reservas",
            get(routes::relatorios::serie_reservas),
        )
        .route(
            "/financeiro/series/vendas",
            get(routes::relatorios::serie_vendas),
        )
        .route(
            "/financeiro/series/por-acomodacao",
            get(routes::relatorios::lucro_por_acomodacao),
        )
        .route(
            "/financeiro/itens-mais-vendidos",
            get(routes::relatorios::itens_mais_vendidos),
        )
        .route("/financeiro/vendas", get(routes::relatorios::vendas))
        // dashboard + auditoria
        .route("/dashboard", get(routes::relatorios::dashboard))
        .route("/auditoria/logs", get(routes::relatorios::logs))
        // histórico de notificações (inbox + badge + read receipts)
        .route("/notificacoes", get(routes::notificacoes::inbox))
        .route(
            "/notificacoes/nao-lidas",
            get(routes::notificacoes::nao_lidas),
        )
        .route(
            "/notificacoes/ler-todas",
            post(routes::notificacoes::ler_todas),
        )
        .route("/notificacoes/{id}/ler", post(routes::notificacoes::ler))
        .route("/notificacoes/{id}", delete(routes::notificacoes::excluir))
        .route("/busca", get(routes::notificacoes::busca))
        // CMS de quartos (admin) — conteúdo editorial, mídia e publicação
        .route("/cms/acomodacoes", get(routes::cms::listar))
        .route("/cms/acomodacoes/{id}", put(routes::cms::salvar))
        .route(
            "/cms/acomodacoes/{id}/status",
            patch(routes::cms::status),
        )
        .route(
            "/cms/acomodacoes/{id}/midia",
            post(routes::cms::upload_midia).route_layer(
                axum::extract::DefaultBodyLimit::max(80 * 1024 * 1024),
            ),
        )
        .route(
            "/cms/acomodacoes/{id}/midia/ordem",
            patch(routes::cms::ordenar_midia),
        )
        .route(
            "/cms/midia/{id}/capa",
            patch(routes::cms::definir_capa),
        )
        .route(
            "/cms/midia/{id}/arquivo",
            get(routes::cms::servir_midia_admin),
        )
        .route("/cms/midia/{id}", delete(routes::cms::remover_midia))
        .layer(TimeoutLayer::with_status_code(
            axum::http::StatusCode::REQUEST_TIMEOUT,
            Duration::from_secs(30),
        ));

    Router::new()
        .route("/healthz", get(healthz))
        .route("/readyz", get(readyz))
        // SSE fica fora do TimeoutLayer — conexão de vida longa por definição.
        .route(
            "/api/v1/notificacoes/stream",
            get(routes::notificacoes::stream),
        )
        .route("/api/v1/publico/stream", get(routes::cms::publico_stream))
        // site público — só conteúdo `publicado`
        .route(
            "/api/v1/publico/acomodacoes",
            get(routes::cms::publico_listar),
        )
        .route(
            "/api/v1/publico/acomodacoes/{slug}",
            get(routes::cms::publico_detalhe),
        )
        .route("/api/v1/midia/{id}", get(routes::cms::servir_midia))
        .nest("/api/v1", api)
        .layer(TraceLayer::new_for_http())
        .layer(PropagateRequestIdLayer::x_request_id())
        .layer(SetRequestIdLayer::x_request_id(
            tower_http::request_id::MakeRequestUuid,
        ))
        .layer(CorsLayer::permissive())
        .with_state(state)
}
