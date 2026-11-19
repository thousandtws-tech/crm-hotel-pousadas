use crate::http::middleware::{self, AlertaErro, IpRateLimit};
use crate::http::routes;
use crate::http::state::AppState;
use axum::extract::State;
use axum::http::header;
use axum::middleware::{from_fn, from_fn_with_state};
use axum::response::IntoResponse;
use axum::routing::{delete, get, patch, post, put};
use axum::Json;
use axum::Router;
use serde_json::json;
use std::time::Duration;
use tower_http::catch_panic::CatchPanicLayer;
use tower_http::compression::CompressionLayer;
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

fn cors_layer(origins: &[String]) -> CorsLayer {
    if origins.iter().any(|o| o == "*") {
        return CorsLayer::permissive();
    }
    let parsed: Vec<axum::http::HeaderValue> = origins
        .iter()
        .filter_map(|o| o.trim().parse().ok())
        .collect();
    CorsLayer::new()
        .allow_origin(parsed)
        .allow_methods([
            axum::http::Method::GET,
            axum::http::Method::POST,
            axum::http::Method::PUT,
            axum::http::Method::PATCH,
            axum::http::Method::DELETE,
            axum::http::Method::OPTIONS,
        ])
        .allow_headers([
            header::AUTHORIZATION,
            header::CONTENT_TYPE,
            axum::http::HeaderName::from_static("x-retry"),
        ])
        .max_age(Duration::from_secs(3600))
}

pub fn build(state: AppState) -> Router {
    let (metric_layer, metric_handle) = axum_prometheus::PrometheusMetricLayer::pair();
    let api: Router<AppState> = Router::new()
        .route(
            "/auth/login",
            post(routes::auth::login).route_layer(from_fn_with_state(
                IpRateLimit::novo(state.login_rate_limit_per_min, Duration::from_secs(60)),
                IpRateLimit::middleware,
            )),
        )
        .route(
            "/auth/register",
            post(routes::auth::register).route_layer(from_fn_with_state(
                IpRateLimit::novo(5, Duration::from_secs(60)),
                IpRateLimit::middleware,
            )),
        )
        .route(
            "/auth/refresh",
            post(routes::auth::refresh).route_layer(from_fn_with_state(
                IpRateLimit::novo(30, Duration::from_secs(60)),
                IpRateLimit::middleware,
            )),
        )
        .route("/auth/logout", post(routes::auth::logout))
        .route("/auth/me", get(routes::auth::me))
        .route(
            "/clientes",
            get(routes::pessoas::listar_clientes).post(routes::pessoas::criar_cliente),
        )
        .route(
            "/clientes/{id}",
            get(routes::pessoas::buscar_cliente)
                .put(routes::pessoas::atualizar_cliente)
                .delete(routes::pessoas::remover_cliente),
        )
        .route(
            "/clientes/{id}/status",
            patch(routes::pessoas::status_cliente),
        )
        .route(
            "/clientes/{id}/foto",
            put(routes::pessoas::upload_foto_cliente)
                .get(routes::pessoas::foto_cliente)
                .delete(routes::pessoas::remover_foto_cliente)
                .route_layer(from_fn(middleware::cache_curto)),
        )
        .route(
            "/clientes/{id}/documentos",
            get(routes::pessoas::listar_documentos).post(routes::pessoas::criar_documento),
        )
        .route("/clientes/{id}/fnrh", get(routes::pessoas::fnrh_cliente))
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
        .route(
            "/funcionarios",
            get(routes::pessoas::listar_funcionarios).post(routes::pessoas::criar_funcionario),
        )
        .route(
            "/funcionarios/{id}",
            get(routes::pessoas::buscar_funcionario)
                .put(routes::pessoas::atualizar_funcionario)
                .delete(routes::pessoas::remover_funcionario),
        )
        .route(
            "/funcionarios/{id}/status",
            patch(routes::pessoas::status_funcionario),
        )
        .route(
            "/cargos",
            get(routes::pessoas::listar_cargos).post(routes::pessoas::criar_cargo),
        )
        .route(
            "/cargos/{id}",
            put(routes::pessoas::atualizar_cargo).delete(routes::pessoas::remover_cargo),
        )
        .route(
            "/tipos-acomodacao",
            get(routes::catalogo::listar_tipos)
                .post(routes::catalogo::criar_tipo)
                .route_layer(from_fn(middleware::cache_curto)),
        )
        .route(
            "/tipos-acomodacao/{id}",
            put(routes::catalogo::atualizar_tipo).delete(routes::catalogo::remover_tipo),
        )
        .route(
            "/tipos-acomodacao/{id}/status",
            patch(routes::catalogo::status_tipo),
        )
        .route(
            "/tipos-acomodacao/{id}/tarifas-ocupacao",
            get(routes::catalogo::tarifas_ocupacao)
                .put(routes::catalogo::salvar_tarifas_ocupacao)
                .route_layer(from_fn(middleware::cache_curto)),
        )
        .route(
            "/acomodacoes",
            get(routes::catalogo::listar_acomodacoes)
                .post(routes::catalogo::criar_acomodacao)
                .route_layer(from_fn(middleware::cache_curto)),
        )
        .route(
            "/acomodacoes/{id}",
            get(routes::catalogo::buscar_acomodacao)
                .put(routes::catalogo::atualizar_acomodacao)
                .delete(routes::catalogo::remover_acomodacao)
                .route_layer(from_fn(middleware::cache_curto)),
        )
        .route(
            "/acomodacoes/{id}/status",
            patch(routes::catalogo::status_acomodacao),
        )
        .route(
            "/acomodacoes/{id}/tarifas",
            get(routes::catalogo::tarifas_acomodacao).route_layer(from_fn(middleware::cache_curto)),
        )
        .route(
            "/acomodacoes/{id}/quartos",
            get(routes::catalogo::listar_quartos)
                .post(routes::catalogo::criar_quarto)
                .route_layer(from_fn(middleware::cache_curto)),
        )
        .route("/quartos/{id}", delete(routes::catalogo::remover_quarto))
        .route(
            "/quartos/{id}/status",
            patch(routes::catalogo::status_quarto),
        )
        .route(
            "/reservas",
            get(routes::reservas::listar_reservas).post(routes::reservas::criar_reserva),
        )
        .route(
            "/reservas/disponibilidade",
            get(routes::reservas::disponibilidade),
        )
        .route("/reservas/eventos", get(routes::reservas::eventos))
        .route("/reservas/mapa", get(routes::reservas::mapa_quartos))
        .route(
            "/reservas/painel-recepcao",
            get(routes::reservas::painel_recepcao),
        )
        .route("/reservas/widget", get(routes::reservas::widget_motor))
        .route(
            "/reservas/{id}/grupo",
            patch(routes::reservas::vincular_grupo),
        )
        .route(
            "/grupos",
            get(routes::reservas::grupos).post(routes::reservas::criar_grupo),
        )
        .route(
            "/grupos/{id}/unidades",
            get(routes::reservas::grupo_unidades),
        )
        .route("/grupos/{id}", delete(routes::reservas::remover_grupo))
        .route(
            "/operadoras",
            get(routes::operadoras::listar)
                .post(routes::operadoras::criar)
                .route_layer(from_fn(middleware::cache_curto)),
        )
        .route("/operadoras/{id}", put(routes::operadoras::atualizar))
        .route(
            "/operadoras/{id}/ativa",
            patch(routes::operadoras::definir_ativa),
        )
        .route("/operadoras/{id}/token", get(routes::operadoras::token))
        .route(
            "/operadoras/{id}/token/rotacionar",
            post(routes::operadoras::rotacionar),
        )
        .route(
            "/operadoras/{id}/faturamento",
            get(routes::operadoras::faturamento),
        )
        .route(
            "/extranet/disponibilidade",
            get(routes::operadoras::extranet_disponibilidade),
        )
        .route(
            "/extranet/reservas",
            post(routes::operadoras::extranet_reservar),
        )
        .route(
            "/contratos",
            get(routes::operadoras::contratos_listar)
                .post(routes::operadoras::contratos_criar)
                .route_layer(from_fn(middleware::cache_curto)),
        )
        .route(
            "/contratos/{id}",
            put(routes::operadoras::contratos_atualizar),
        )
        .route(
            "/contratos/{id}/ativo",
            patch(routes::operadoras::contratos_definir_ativo),
        )
        .route("/bloqueios", get(routes::reservas::bloqueios))
        .route(
            "/bloqueios/{id}",
            axum::routing::delete(routes::reservas::desbloquear),
        )
        .route(
            "/acomodacoes/{id}/bloqueio",
            post(routes::reservas::bloquear),
        )
        .route(
            "/reservas/{id}",
            get(routes::reservas::buscar_reserva).delete(routes::reservas::remover_reserva),
        )
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
        .route(
            "/reservas/{id}/comunicacoes",
            get(routes::reservas::comunicacoes_reserva),
        )
        .route(
            "/reservas/{id}/comunicacoes/{item}/reenviar",
            post(routes::reservas::reenviar_comunicacao),
        )
        .route("/fnrh/exportar", get(routes::reservas::exportar_fnrh))
        .route(
            "/fechamento/pendencias",
            get(routes::reservas::pendencias_fechamento),
        )
        .route(
            "/fechamento/relatorio",
            post(routes::reservas::enviar_relatorio_fechamento),
        )
        .route(
            "/reservas/{id}/no-show",
            post(routes::reservas::marcar_no_show),
        )
        .route(
            "/pagamentos",
            get(routes::pagamentos_online::listar_pagamentos),
        )
        .route(
            "/pagamentos/{id}/reembolsos",
            post(routes::pagamentos_online::reembolsar_pagamento),
        )
        .route(
            "/reservas/{id}/pagamentos",
            get(routes::pagamentos_online::pagamentos_da_reserva),
        )
        .route(
            "/financeiro/pagamentos/resumo",
            get(routes::pagamentos_online::resumo_financeiro),
        )
        .route(
            "/financeiro/pagamentos/receita-acomodacoes",
            get(routes::pagamentos_online::receita_acomodacoes),
        )
        .route("/integracoes", get(routes::integracoes::listar_integracoes))
        .route(
            "/integracoes/{provedor}/{ambiente}",
            get(routes::integracoes::detalhe_integracao)
                .put(routes::integracoes::salvar_integracao),
        )
        .route(
            "/integracoes/{provedor}/{ambiente}/habilitacao",
            patch(routes::integracoes::habilitacao_integracao),
        )
        .route(
            "/integracoes/{provedor}/{ambiente}/testar",
            post(routes::integracoes::testar_integracao),
        )
        .route(
            "/integracoes/{provedor}/{ambiente}/padrao",
            put(routes::integracoes::padrao_integracao),
        )
        .route(
            "/integracoes/{provedor}/{ambiente}/eventos",
            get(routes::integracoes::eventos_integracao),
        )
        .route(
            "/integracoes/zapi/{ambiente}/qr-code",
            post(routes::integracoes::zapi_qr),
        )
        .route(
            "/integracoes/zapi/{ambiente}/webhooks",
            post(routes::integracoes::zapi_webhooks),
        )
        .route(
            "/integracoes/zapi/{ambiente}/teste-msg",
            post(routes::integracoes::zapi_teste),
        )
        .route(
            "/integracoes/zapi/{ambiente}/desconectar",
            post(routes::integracoes::zapi_desconectar),
        )
        .route(
            "/integracoes/infobip/{ambiente}/teste-msg",
            post(routes::integracoes::infobip_teste),
        )
        // ---- Fiscal (Spedy/NFS-e) — config + documentos -------------------
        .route(
            "/integracoes/spedy/{ambiente}/empresa",
            post(routes::fiscal::spedy_empresa),
        )
        .route(
            "/integracoes/spedy/{ambiente}/municipio/{ibge}",
            get(routes::fiscal::spedy_municipio),
        )
        .route(
            "/integracoes/spedy/{ambiente}/settings",
            get(routes::fiscal::spedy_settings),
        )
        .route(
            "/integracoes/spedy/{ambiente}/webhook",
            post(routes::fiscal::spedy_webhook_config),
        )
        .route(
            "/fiscal/nfse/{ambiente}/reserva/{idreserva}/preparar",
            post(routes::fiscal::preparar_nfse),
        )
        .route("/fiscal/documentos", get(routes::fiscal::listar_docs))
        .route(
            "/fiscal/reserva/{idreserva}",
            get(routes::fiscal::docs_reserva),
        )
        .route(
            "/fiscal/documentos/{iddoc}",
            get(routes::fiscal::detalhe_doc),
        )
        .route(
            "/fiscal/documentos/{iddoc}/confirmar",
            post(routes::fiscal::confirmar_doc),
        )
        .route(
            "/fiscal/documentos/{iddoc}/sincronizar",
            post(routes::fiscal::sincronizar_doc),
        )
        .route(
            "/fiscal/documentos/{iddoc}/reconciliar",
            post(routes::fiscal::reconciliar_doc),
        )
        .route(
            "/fiscal/documentos/{iddoc}/reprocessar",
            post(routes::fiscal::reprocessar_doc),
        )
        .route(
            "/fiscal/documentos/{iddoc}/cancelar",
            post(routes::fiscal::cancelar_doc),
        )
        .route(
            "/fiscal/documentos/{iddoc}/arquivo/{tipo}",
            get(routes::fiscal::arquivo_doc),
        )
        // ---- Verificação de identidade (Didit) — KYC de funcionários ---
        .route("/verificacao/minha", get(routes::verificacao::minha))
        .route(
            "/verificacao/minha/sessao",
            post(routes::verificacao::minha_sessao),
        )
        .route("/verificacao", get(routes::verificacao::listar))
        .route(
            "/verificacao/funcionarios/{idfuncionario}",
            get(routes::verificacao::status_funcionario),
        )
        .route(
            "/verificacao/funcionarios/{idfuncionario}/sessao",
            post(routes::verificacao::sessao_funcionario),
        )
        .route(
            "/verificacao/{id}/sincronizar",
            post(routes::verificacao::sincronizar),
        )
        .route(
            "/integracoes/didit/{ambiente}/config",
            post(routes::verificacao::didit_config),
        )
        .route(
            "/integracoes/didit/{ambiente}/webhook",
            post(routes::verificacao::didit_webhook_config),
        )
        .route(
            "/comunicacao/painel",
            get(routes::comunicacao::painel_comunicacao),
        )
        .route("/comunicacao/fila", get(routes::comunicacao::fila_listar))
        .route(
            "/comunicacao/campanhas",
            get(routes::comunicacao::campanhas_listar).post(routes::comunicacao::campanhas_criar),
        )
        .route(
            "/comunicacao/matriz",
            get(routes::comunicacao::matriz_listar).post(routes::comunicacao::matriz_gravar),
        )
        .route(
            "/comunicacao/cobranca/{idreserva}",
            post(routes::comunicacao::cobranca_enviar),
        )
        .route("/push/subscribe", post(routes::comunicacao::push_subscribe))
        .route(
            "/push/unsubscribe",
            post(routes::comunicacao::push_unsubscribe),
        )
        .route("/push/vapid-key", get(routes::comunicacao::push_vapid_key))
        .route("/avaliacoes", get(routes::comunicacao::avaliacoes_listar))
        .route(
            "/avaliacoes/dashboard",
            get(routes::comunicacao::avaliacoes_dashboard),
        )
        .route(
            "/avaliacoes/{id}/responder",
            post(routes::comunicacao::avaliacao_responder),
        )
        .route(
            "/fidelidade/niveis",
            get(routes::comunicacao::fidelidade_niveis_get)
                .post(routes::comunicacao::fidelidade_niveis_post),
        )
        .route(
            "/fidelidade/niveis/{id}",
            axum::routing::delete(routes::comunicacao::fidelidade_niveis_delete),
        )
        .route(
            "/clientes/{id}/perfil360",
            get(routes::comunicacao::cliente_perfil360),
        )
        .route("/lgpd/solicitacoes", get(routes::comunicacao::lgpd_listar))
        .route(
            "/lgpd/solicitacoes/{id}/responder",
            post(routes::comunicacao::lgpd_responder),
        )
        .route(
            "/clientes/{id}/lgpd-export",
            get(routes::comunicacao::lgpd_exportar_admin),
        )
        .route(
            "/clientes/{id}/anonimizar",
            post(routes::comunicacao::lgpd_anonimizar),
        )
        .route(
            "/lgpd/incidentes",
            get(routes::comunicacao::lgpd_incidente_listar)
                .post(routes::comunicacao::lgpd_incidente_criar),
        )
        .route(
            "/lgpd/incidentes/{id}/comunicar",
            post(routes::comunicacao::lgpd_incidente_comunicar),
        )
        .route("/atendimentos", get(routes::comunicacao::atendimentos_get))
        .route(
            "/atendimentos/{id}/aceitar",
            post(routes::comunicacao::atendimento_aceitar_post),
        )
        .route(
            "/atendimentos/{id}/resolver",
            post(routes::comunicacao::atendimento_resolver_post),
        )
        .route(
            "/reservas/{id}/autorizacao-menor",
            post(routes::comunicacao::reserva_autorizacao_menor),
        )
        .route(
            "/manutencao/ordens",
            get(routes::operacao::ordens_listar).post(routes::operacao::ordem_criar),
        )
        .route(
            "/manutencao/ordens/{id}/status",
            post(routes::operacao::ordem_status),
        )
        .route(
            "/manutencao/pmoc",
            get(routes::operacao::pmoc_listar).post(routes::operacao::pmoc_registrar),
        )
        .route("/manutencao/pmoc/itens", get(routes::operacao::pmoc_itens))
        .route(
            "/governanca/tarefas",
            get(routes::operacao::gov_quadro).post(routes::operacao::gov_criar),
        )
        .route(
            "/governanca/tarefas/{id}/status",
            post(routes::operacao::gov_status),
        )
        .route(
            "/governanca/tarefas/{id}/atribuir",
            post(routes::operacao::gov_atribuir),
        )
        .route("/governanca/previsao", get(routes::operacao::gov_previsao))
        .route("/governanca/gerar-d1", post(routes::operacao::gov_gerar_d1))
        .route(
            "/governanca/lavanderia",
            get(routes::operacao::lav_lotes).post(routes::operacao::lav_abrir),
        )
        .route(
            "/governanca/lavanderia/{id}/devolver",
            post(routes::operacao::lav_devolver),
        )
        .route(
            "/governanca/lavanderia/fechar",
            post(routes::operacao::lav_fechar),
        )
        .route(
            "/governanca/enxoval",
            get(routes::operacao::enxoval_movs).post(routes::operacao::enxoval_registrar),
        )
        .route(
            "/governanca/enxoval/saldo",
            get(routes::operacao::enxoval_saldo),
        )
        .route(
            "/escalas/jornadas",
            get(routes::operacao::jornadas_listar).post(routes::operacao::jornada_gravar),
        )
        .route("/escalas/turnos", get(routes::operacao::turnos_listar))
        .route(
            "/escalas/turnos/{id}",
            delete(routes::operacao::turno_remover).put(routes::operacao::turno_editar),
        )
        .route("/escalas/clt/validar", get(routes::operacao::clt_validar))
        .route(
            "/escalas/clt/corrigir",
            post(routes::operacao::clt_corrigir),
        )
        .route("/ia/resumo", get(routes::preditivo::ia_resumo))
        .route("/ia/ocupacao-14d", get(routes::preditivo::ia_ocupacao))
        .route("/ia/receita-4sem", get(routes::preditivo::ia_receita))
        .route("/ia/fluxo-caixa-30d", get(routes::preditivo::ia_fluxo))
        .route("/ia/risco-cancelamentos", get(routes::preditivo::ia_riscos))
        .route("/ia/perfis-hospedes", get(routes::preditivo::ia_perfis))
        .route("/ia/pace", get(routes::preditivo::ia_pace))
        .route("/ia/escala-ideal", get(routes::preditivo::ia_escala))
        .route("/ia/upsell", get(routes::preditivo::ia_upsell))
        .route("/ia/estoque-previsto", get(routes::preditivo::ia_estoque))
        .route(
            "/ia/manutencao-preventiva",
            get(routes::preditivo::ia_manutencao),
        )
        .route("/ia/historico-12m", get(routes::preditivo::ia_historico))
        // estoque
        .route(
            "/estoque/categorias",
            get(routes::estoque::listar_categorias)
                .post(routes::estoque::criar_categoria)
                .route_layer(from_fn(middleware::cache_curto)),
        )
        .route(
            "/estoque/categorias/{id}",
            delete(routes::estoque::remover_categoria),
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
            get(routes::estoque::buscar_item)
                .put(routes::estoque::atualizar_item)
                .delete(routes::estoque::remover_item),
        )
        .route(
            "/estoque/itens/{id}/status",
            patch(routes::estoque::status_item),
        )
        .route(
            "/estoque/itens/{id}/etiqueta",
            post(routes::estoque::imprimir_etiqueta),
        )
        .route(
            "/estoque/movimentacoes",
            get(routes::estoque::listar_movimentos).post(routes::estoque::movimentar),
        )
        .route("/estoque/alertas", get(routes::estoque::alertas_minimo))
        .route(
            "/estoque/itens/{id}/ficha",
            get(routes::estoque::listar_ficha).post(routes::estoque::salvar_ficha_item),
        )
        .route(
            "/estoque/ficha/{id}",
            delete(routes::estoque::remover_ficha_item),
        )
        .route(
            "/estoque/itens/{id}/conversoes",
            get(routes::estoque::listar_conversoes).post(routes::estoque::salvar_conversao),
        )
        .route(
            "/estoque/conversoes/{id}",
            delete(routes::estoque::remover_conversao),
        )
        .route("/estoque/nfe/preview", post(routes::estoque::preview_nfe))
        .route("/estoque/nfe/importar", post(routes::estoque::importar_nfe))
        .route(
            "/compras/fornecedores",
            get(routes::compras::listar_fornecedores).post(routes::compras::salvar_fornecedor),
        )
        .route(
            "/compras/fornecedores/{id}/status",
            patch(routes::compras::status_fornecedor),
        )
        .route(
            "/compras/pedidos",
            get(routes::compras::listar_pedidos).post(routes::compras::criar_pedido),
        )
        .route("/compras/pedidos/{id}", get(routes::compras::buscar_pedido))
        .route(
            "/compras/pedidos/{id}/receber",
            post(routes::compras::receber_pedido),
        )
        .route(
            "/compras/pedidos/{id}/cancelar",
            post(routes::compras::cancelar_pedido),
        )
        // frigobares
        .route(
            "/frigobares/painel",
            get(routes::catalogo::painel_frigobares),
        )
        .route(
            "/frigobares",
            get(routes::catalogo::listar_frigobares).post(routes::catalogo::criar_frigobar),
        )
        .route(
            "/frigobares/{id}",
            get(routes::catalogo::buscar_frigobar)
                .put(routes::catalogo::atualizar_frigobar)
                .delete(routes::catalogo::remover_frigobar),
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
            "/estacionamento/painel",
            get(routes::catalogo::painel_estacionamento),
        )
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
            put(routes::catalogo::atualizar_pagamento).delete(routes::catalogo::remover_pagamento),
        )
        .route(
            "/formas-pagamento/{id}/status",
            patch(routes::catalogo::status_pagamento),
        )
        // estabelecimento
        .route(
            "/estabelecimento",
            get(routes::catalogo::obter_estabelecimento)
                .put(routes::catalogo::salvar_estabelecimento)
                .route_layer(from_fn(middleware::cache_curto)),
        )
        .route(
            "/estabelecimento/endereco",
            get(routes::catalogo::obter_endereco)
                .put(routes::catalogo::salvar_endereco)
                .route_layer(from_fn(middleware::cache_curto)),
        )
        .route(
            "/estabelecimento/logo",
            post(routes::catalogo::upload_logo).get(routes::catalogo::logo),
        )
        .route(
            "/impressoras",
            get(routes::impressoras::listar).post(routes::impressoras::criar),
        )
        .route(
            "/impressoras/descobertas",
            get(routes::impressoras::listar_descobertas)
                .post(routes::impressoras::push_descobertas),
        )
        .route(
            "/impressoras/descobertas/{id}/registrar",
            post(routes::impressoras::registrar_descoberta),
        )
        .route(
            "/impressoras/descobertas/{id}",
            axum::routing::delete(routes::impressoras::ignorar_descoberta),
        )
        .route(
            "/impressoras/jobs/pendentes",
            get(routes::impressoras::jobs_pendentes),
        )
        .route(
            "/impressoras/jobs/{id}/resultado",
            post(routes::impressoras::resultado_job),
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
            "/financeiro/painel",
            get(routes::relatorios::painel_financeiro)
                .route_layer(from_fn(middleware::cache_curto)),
        )
        .route(
            "/financeiro/painel-completo",
            get(routes::relatorios::painel_completo).route_layer(from_fn(middleware::cache_curto)),
        )
        .route(
            "/financeiro/series/recebido",
            get(routes::relatorios::serie_recebido).route_layer(from_fn(middleware::cache_curto)),
        )
        .route(
            "/financeiro/series/por-pagamento",
            get(routes::relatorios::serie_por_pagamento)
                .route_layer(from_fn(middleware::cache_curto)),
        )
        .route(
            "/financeiro/series/reservas",
            get(routes::relatorios::serie_reservas).route_layer(from_fn(middleware::cache_curto)),
        )
        .route(
            "/financeiro/series/vendas",
            get(routes::relatorios::serie_vendas).route_layer(from_fn(middleware::cache_curto)),
        )
        .route(
            "/financeiro/series/por-acomodacao",
            get(routes::relatorios::lucro_por_acomodacao)
                .route_layer(from_fn(middleware::cache_curto)),
        )
        .route(
            "/financeiro/itens-mais-vendidos",
            get(routes::relatorios::itens_mais_vendidos)
                .route_layer(from_fn(middleware::cache_curto)),
        )
        .route(
            "/financeiro/vendas",
            get(routes::relatorios::vendas).route_layer(from_fn(middleware::cache_curto)),
        )
        .route(
            "/financeiro/plano-contas",
            get(routes::tesouraria::listar_plano_contas)
                .post(routes::tesouraria::criar_plano_conta),
        )
        .route(
            "/financeiro/plano-contas/{id}",
            put(routes::tesouraria::atualizar_plano_conta)
                .delete(routes::tesouraria::remover_plano_conta),
        )
        .route(
            "/financeiro/plano-contas/{id}/status",
            patch(routes::tesouraria::status_plano_conta),
        )
        .route(
            "/financeiro/contas",
            get(routes::tesouraria::listar_contas).post(routes::tesouraria::criar_conta),
        )
        .route(
            "/financeiro/contas/{id}",
            put(routes::tesouraria::atualizar_conta),
        )
        .route(
            "/financeiro/contas/{id}/status",
            patch(routes::tesouraria::status_conta),
        )
        .route(
            "/financeiro/contas/{id}/saldo",
            get(routes::tesouraria::saldo_conta),
        )
        .route(
            "/financeiro/lancamentos",
            get(routes::tesouraria::listar_lancamentos).post(routes::tesouraria::criar_lancamento),
        )
        .route(
            "/financeiro/lancamentos/{id}",
            get(routes::tesouraria::buscar_lancamento)
                .put(routes::tesouraria::atualizar_lancamento)
                .delete(routes::tesouraria::remover_lancamento),
        )
        .route(
            "/financeiro/lancamentos/{id}/cancelar",
            post(routes::tesouraria::cancelar_lancamento),
        )
        .route(
            "/financeiro/lancamentos/{id}/baixar",
            post(routes::tesouraria::baixar),
        )
        .route(
            "/financeiro/lancamentos/{id}/baixas",
            get(routes::tesouraria::listar_baixas),
        )
        .route(
            "/financeiro/fluxo-caixa",
            get(routes::tesouraria::fluxo_caixa),
        )
        .route("/financeiro/dre", get(routes::tesouraria::dre))
        .route(
            "/financeiro/extrato",
            get(routes::tesouraria::listar_extrato).post(routes::tesouraria::importar_extrato),
        )
        .route(
            "/financeiro/extrato/resumo",
            get(routes::tesouraria::resumo_extrato),
        )
        .route(
            "/financeiro/extrato/{id}/ignorar",
            post(routes::tesouraria::ignorar_extrato),
        )
        .route(
            "/financeiro/extrato/{id}/sugestoes",
            get(routes::tesouraria::sugestoes_extrato),
        )
        .route(
            "/financeiro/extrato/{id}/conciliar",
            post(routes::tesouraria::conciliar),
        )
        .route(
            "/financeiro/extrato/{id}/classificar",
            post(routes::tesouraria::classificar_extrato),
        )
        .route(
            "/financeiro/conciliacoes/{id}",
            delete(routes::tesouraria::desconciliar),
        )
        .route(
            "/financeiro/conciliar-auto/{idconta}",
            post(routes::tesouraria::auto_conciliar),
        )
        .route(
            "/financeiro/tributos",
            get(routes::tesouraria::tributo_config).post(routes::tesouraria::criar_tributo_config),
        )
        .route(
            "/financeiro/tributos/historico",
            get(routes::tesouraria::listar_tributo_configs),
        )
        .route(
            "/financeiro/split/resumo",
            get(routes::tesouraria::split_resumo),
        )
        .route(
            "/financeiro/split/eventos",
            get(routes::tesouraria::split_eventos),
        )
        .route(
            "/financeiro/apuracoes",
            get(routes::tesouraria::listar_apuracoes),
        )
        .route(
            "/financeiro/apuracoes/recolher",
            post(routes::tesouraria::recolher_apuracao),
        )
        .route("/financeiro/caixa/aberto", get(routes::caixa::turno_aberto))
        .route(
            "/financeiro/caixa/turnos",
            get(routes::caixa::listar_turnos).post(routes::caixa::abrir),
        )
        .route(
            "/financeiro/caixa/turnos/{id}",
            get(routes::caixa::buscar_turno),
        )
        .route(
            "/financeiro/caixa/turnos/{id}/conferencia",
            get(routes::caixa::conferir),
        )
        .route(
            "/financeiro/caixa/turnos/{id}/movimentos",
            get(routes::caixa::listar_movimentos).post(routes::caixa::movimentar),
        )
        .route(
            "/financeiro/caixa/turnos/{id}/fechar",
            post(routes::caixa::fechar),
        )
        .route(
            "/pdv/mesas",
            get(routes::pdv::listar_mesas).post(routes::pdv::criar_mesa),
        )
        .route("/pdv/painel", get(routes::pdv::painel_pdv))
        .route("/pdv/mesas/{id}/status", put(routes::pdv::status_mesa))
        .route(
            "/pdv/garcons",
            get(routes::pdv::listar_garcons).post(routes::pdv::salvar_garcom),
        )
        .route(
            "/pdv/comandas",
            get(routes::pdv::listar_comandas).post(routes::pdv::abrir_comanda),
        )
        .route("/pdv/comandas/{id}", get(routes::pdv::buscar_comanda))
        .route(
            "/pdv/comandas/{id}/cancelar",
            post(routes::pdv::cancelar_comanda),
        )
        .route(
            "/pdv/comandas/{id}/fechar",
            post(routes::pdv::fechar_comanda),
        )
        .route(
            "/pdv/comandas/{id}/itens",
            get(routes::pdv::listar_itens).post(routes::pdv::adicionar_item),
        )
        .route(
            "/pdv/comandas/{id}/itens/{item}/entregar",
            post(routes::pdv::entregar_item),
        )
        .route(
            "/pdv/comandas/{id}/itens/{item}/cancelar",
            post(routes::pdv::cancelar_item),
        )
        .route("/pdv/cozinha/fila", get(routes::pdv::fila_cozinha))
        .route(
            "/pdv/comandas/{id}/itens/{item}/preparar",
            post(routes::pdv::iniciar_preparo),
        )
        .route(
            "/pdv/comandas/{id}/itens/{item}/pronto",
            post(routes::pdv::marcar_pronto),
        )
        .route(
            "/pdv/comandas/{id}/itens/{item}/retornar",
            post(routes::pdv::retornar_fila),
        )
        .route("/cafe/quadro", get(routes::cafe::quadro))
        .route("/cafe/presencas", post(routes::cafe::registrar))
        .route(
            "/cafe/presencas/{id}",
            axum::routing::delete(routes::cafe::remover),
        )
        .route("/cafe/historico", get(routes::cafe::historico))
        .route("/pdv/itens-venda", get(routes::pdv::listar_itens_venda))
        .route("/pdv/comissoes", get(routes::pdv::listar_comissoes))
        .route("/pdv/comissoes/resumo", get(routes::pdv::resumo_comissoes))
        .route(
            "/pdv/comissoes/{id}/pagar",
            post(routes::pdv::pagar_comissao),
        )
        .route("/dashboard", get(routes::relatorios::dashboard))
        .route("/auditoria/logs", get(routes::relatorios::logs))
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
        .route(
            "/notificacoes/stream-ticket",
            post(routes::notificacoes::stream_ticket),
        )
        .route("/notificacoes/{id}", delete(routes::notificacoes::excluir))
        .route("/busca", get(routes::notificacoes::busca))
        // CMS de quartos (admin) — conteúdo editorial, mídia e publicação
        .route("/cms/site", get(routes::cms::site_secoes))
        .route("/cms/site/{secao}", put(routes::cms::site_salvar))
        .route(
            "/cms/acomodacoes",
            get(routes::cms::listar).route_layer(from_fn(middleware::cache_curto)),
        )
        .route("/cms/acomodacoes/{id}", put(routes::cms::salvar))
        .route("/cms/acomodacoes/{id}/status", patch(routes::cms::status))
        .route(
            "/cms/acomodacoes/{id}/midia",
            post(routes::cms::upload_midia)
                .route_layer(axum::extract::DefaultBodyLimit::max(80 * 1024 * 1024)),
        )
        .route(
            "/cms/acomodacoes/{id}/midia/ordem",
            patch(routes::cms::ordenar_midia),
        )
        .route("/cms/midia/{id}/capa", patch(routes::cms::definir_capa))
        .route(
            "/cms/midia/{id}/arquivo",
            get(routes::cms::servir_midia_admin),
        )
        .route("/cms/midia/{id}", delete(routes::cms::remover_midia))
        .layer(TimeoutLayer::with_status_code(
            axum::http::StatusCode::REQUEST_TIMEOUT,
            Duration::from_secs(30),
        ));

    let router = Router::new()
        .route("/healthz", get(healthz))
        .route("/readyz", get(readyz))
        .route(
            "/api/v1/notificacoes/stream",
            get(routes::notificacoes::stream),
        )
        .route("/api/v1/publico/stream", get(routes::cms::publico_stream))
        .route(
            "/api/v1/publico/cms/site",
            get(routes::cms::publico_site).route_layer(from_fn(middleware::cache_publico)),
        )
        .route(
            "/api/v1/publico/newsletter",
            post(routes::cms::publico_newsletter),
        )
        .route(
            "/api/v1/publico/contrato/{codigo}",
            get(routes::operadoras::publico_contrato),
        )
        .route(
            "/api/v1/publico/acomodacoes",
            get(routes::cms::publico_listar).route_layer(from_fn(middleware::cache_publico)),
        )
        .route(
            "/api/v1/publico/acomodacoes/{slug}",
            get(routes::cms::publico_detalhe).route_layer(from_fn(middleware::cache_publico)),
        )
        .route(
            "/api/v1/publico/reservas",
            post(routes::cms::publico_criar_reserva).route_layer(from_fn_with_state(
                IpRateLimit::novo(8, Duration::from_secs(60)),
                IpRateLimit::middleware,
            )),
        )
        // Motor de busca do site — leitura, mas cada request consulta N
        // períodos: limite maior que reserva, menor que status.
        .route(
            "/api/v1/publico/disponibilidade/busca",
            post(routes::cms::publico_busca_disponibilidade).route_layer(from_fn_with_state(
                IpRateLimit::novo(30, Duration::from_secs(60)),
                IpRateLimit::middleware,
            )),
        )
        .route(
            "/api/v1/publico/pagamentos/checkout",
            post(routes::pagamentos_online::checkout_publico).route_layer(from_fn_with_state(
                IpRateLimit::novo(10, Duration::from_secs(60)),
                IpRateLimit::middleware,
            )),
        )
        .route(
            "/api/v1/publico/pagamentos/status",
            get(routes::pagamentos_online::status_publico).route_layer(from_fn_with_state(
                IpRateLimit::novo(60, Duration::from_secs(60)),
                IpRateLimit::middleware,
            )),
        )
        .route(
            "/api/v1/webhooks/stripe",
            post(routes::pagamentos_online::webhook_stripe),
        )
        .route(
            "/api/v1/webhooks/pagbank",
            post(routes::pagamentos_online::webhook_pagbank),
        )
        .route(
            "/api/v1/webhooks/mercadopago",
            post(routes::pagamentos_online::webhook_mercadopago),
        )
        // webhook Resend — bounce/complaint → supressão. Origem = Resend.
        .route(
            "/api/v1/webhooks/resend",
            post(routes::comunicacao::webhook_resend),
        )
        // webhook WhatsApp — verify handshake (GET) + mensagens inbound
        // (POST assinado com X-Hub-Signature-256). Origem = Meta.
        .route(
            "/api/v1/webhooks/whatsapp",
            get(routes::comunicacao::whatsapp_verify).post(routes::comunicacao::whatsapp_inbound),
        )
        // webhook Z-API — bearer no path + instanceId. Origem = Z-API.
        .route(
            "/api/v1/webhooks/zapi/{segredo}",
            post(routes::comunicacao::webhook_zapi),
        )
        .route(
            "/api/v1/webhooks/infobip/{segredo}",
            post(routes::comunicacao::webhook_infobip),
        )
        // webhook Spedy — Standard Webhooks (assinatura HMAC obrigatória).
        .route(
            "/api/v1/webhooks/spedy/{ambiente}",
            post(routes::fiscal::webhook_spedy),
        )
        // webhook Didit — X-Signature HMAC-SHA256 + X-Timestamp (obrigatórios).
        .route(
            "/api/v1/webhooks/didit/{ambiente}",
            post(routes::verificacao::webhook_didit),
        )
        // webhook Channex — x-hmac-timestamp + x-hmac-signature-256
        // (hex, CSV p/ rotação) sobre `{ts}.{corpo cru}`.
        .route(
            "/api/v1/webhooks/channex/{ambiente}",
            post(routes::distribuicao::webhook_channex),
        )
        // Inná Concierge — chat do hóspede no portal, escopo = token opaco.
        .route(
            "/api/v1/publico/concierge/{token}",
            get(routes::comunicacao::concierge_get)
                .post(routes::comunicacao::concierge_post)
                .route_layer(from_fn_with_state(
                    IpRateLimit::novo(20, Duration::from_secs(60)),
                    IpRateLimit::middleware,
                )),
        )
        // pré-ficha FNRH pública — link único por reserva (token opaco)
        .route(
            "/api/v1/publico/fnrh/{token}",
            get(routes::comunicacao::pre_ficha_get)
                .post(routes::comunicacao::pre_ficha_post)
                .route_layer(from_fn_with_state(
                    IpRateLimit::novo(20, Duration::from_secs(60)),
                    IpRateLimit::middleware,
                )),
        )
        .route(
            "/api/v1/publico/avaliacoes/{token}",
            get(routes::comunicacao::avaliacao_get)
                .post(routes::comunicacao::avaliacao_post)
                .route_layer(from_fn_with_state(
                    IpRateLimit::novo(20, Duration::from_secs(60)),
                    IpRateLimit::middleware,
                )),
        )
        .route(
            "/api/v1/publico/lgpd/descadastrar",
            get(routes::comunicacao::lgpd_descadastrar),
        )
        .route(
            "/api/v1/publico/lgpd/{token}",
            get(routes::comunicacao::lgpd_exportar_publico)
                .post(routes::comunicacao::lgpd_solicitar)
                .route_layer(from_fn_with_state(
                    IpRateLimit::novo(10, Duration::from_secs(60)),
                    IpRateLimit::middleware,
                )),
        )
        // documento do titular — PDF + envio por e-mail/WhatsApp
        .route(
            "/api/v1/publico/lgpd/{token}/dados.pdf",
            get(routes::comunicacao::lgpd_pdf_publico).route_layer(from_fn_with_state(
                IpRateLimit::novo(10, Duration::from_secs(60)),
                IpRateLimit::middleware,
            )),
        )
        .route(
            "/api/v1/publico/lgpd/{token}/enviar",
            post(routes::comunicacao::lgpd_enviar_publico).route_layer(from_fn_with_state(
                IpRateLimit::novo(10, Duration::from_secs(60)),
                IpRateLimit::middleware,
            )),
        )
        .route("/api/v1/midia/{id}", get(routes::cms::servir_midia))
        .route(
            "/metrics",
            get(move || {
                let handle = metric_handle.clone();
                async move { handle.render() }
            }),
        )
        .nest("/api/v1", api.merge(routes::distribuicao::rotas()))
        .layer(
            TraceLayer::new_for_http().make_span_with(|req: &axum::extract::Request| {
                tracing::info_span!(
                    "request",
                    method = %req.method(),
                    path = %req.uri().path(),
                )
            }),
        )
        .layer(PropagateRequestIdLayer::x_request_id())
        .layer(SetRequestIdLayer::x_request_id(
            tower_http::request_id::MakeRequestUuid,
        ))
        .layer(CompressionLayer::new())
        .layer(from_fn(middleware::security_headers))
        .layer(cors_layer(&state.cors_origins))
        .layer(metric_layer)
        .layer(CatchPanicLayer::custom(|_| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"erro": {
                    "codigo": "INTERNO",
                    "mensagem": "Erro interno. Tente novamente.",
                }})),
            )
                .into_response()
        }));

    let router = match state.alert_webhook_url.as_deref() {
        Some(url) => router.layer(from_fn_with_state(
            AlertaErro::novo(url),
            AlertaErro::middleware,
        )),
        None => router,
    };
    router.with_state(state)
}
