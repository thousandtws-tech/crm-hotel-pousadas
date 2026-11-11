//! Árvore de rotas `/api/v1` + middlewares de observabilidade e robustez.

use crate::mw::{self, IpRateLimit};
use crate::routes;
use crate::state::AppState;
use axum::extract::State;
use axum::http::header;
use axum::middleware::{from_fn, from_fn_with_state};
use axum::routing::{delete, get, patch, post, put};
use axum::Json;
use axum::Router;
use serde_json::json;
use std::time::Duration;
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

/// CORS a partir de `CORS_ORIGINS`: `*` (dev) → permissive; caso
/// contrário a lista exata de origens com métodos/headers da API.
/// Auth é por `Authorization` header (não cookie) — credentials off.
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
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE])
        .max_age(Duration::from_secs(3600))
}

pub fn build(state: AppState) -> Router {
    let (metric_layer, metric_handle) = axum_prometheus::PrometheusMetricLayer::pair();
    let api: Router<AppState> = Router::new()
        // auth — login/refresh públicos (login/register com rate limit
        // por IP: Argon2 é CPU-bound — sem teto vira DoS + brute-force)
        .route(
            "/auth/login",
            post(routes::auth::login).route_layer(from_fn_with_state(
                IpRateLimit::novo(10, Duration::from_secs(60)),
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
        // clientes
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
                .delete(routes::pessoas::remover_foto_cliente),
        )
        // documentos de identidade do cliente
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
        // funcionários (admin)
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
        // tipos de acomodação
        .route(
            "/tipos-acomodacao",
            get(routes::catalogo::listar_tipos).post(routes::catalogo::criar_tipo),
        )
        .route(
            "/tipos-acomodacao/{id}",
            put(routes::catalogo::atualizar_tipo).delete(routes::catalogo::remover_tipo),
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
            get(routes::catalogo::buscar_acomodacao)
                .put(routes::catalogo::atualizar_acomodacao)
                .delete(routes::catalogo::remover_acomodacao),
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
        .route("/quartos/{id}", delete(routes::catalogo::remover_quarto))
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
        // Mapa por andar + bloqueio formal
        .route("/reservas/mapa", get(routes::reservas::mapa_quartos))
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
        // pagamentos online (Stripe) — painel financeiro
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
        // comunicação — fila, matriz, push, cobrança
        .route("/comunicacao/fila", get(routes::comunicacao::fila_listar))
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
        // avaliações — painel reputação
        .route("/avaliacoes", get(routes::comunicacao::avaliacoes_listar))
        .route(
            "/avaliacoes/dashboard",
            get(routes::comunicacao::avaliacoes_dashboard),
        )
        .route(
            "/avaliacoes/{id}/responder",
            post(routes::comunicacao::avaliacao_responder),
        )
        // fidelidade + perfil 360
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
        // LGPD — solicitações do titular, export, anonimização, ECA
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
        // Atendimento — fila de protocolos por setor com SLA
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
        // operação — manutenção & PMOC
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
        // governança — tarefas, previsão, D-1
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
        // lavanderia & enxoval
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
        // escalas & CLT
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
        // inteligência preditiva (Inná) — leitura analítica
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
            get(routes::estoque::listar_categorias).post(routes::estoque::criar_categoria),
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
        // tesouraria — plano de contas
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
        // tesouraria — contas financeiras
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
        // tesouraria — lançamentos (contas a pagar/receber)
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
        // tesouraria — fluxo de caixa e DRE
        .route(
            "/financeiro/fluxo-caixa",
            get(routes::tesouraria::fluxo_caixa),
        )
        .route("/financeiro/dre", get(routes::tesouraria::dre))
        // tesouraria — extrato e conciliação
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
        // tesouraria — tributos e split payment IBS/CBS
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
        // controle de caixa — turnos de gaveta
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
        // PDV & comandas — mesas, garçons, vendas salão/quarto/balcão
        .route(
            "/pdv/mesas",
            get(routes::pdv::listar_mesas).post(routes::pdv::criar_mesa),
        )
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
        // KDS — cozinha em tempo real
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
        // café da manhã — presença por reserva/dia
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
        .route(
            "/notificacoes/stream-ticket",
            post(routes::notificacoes::stream_ticket),
        )
        .route("/notificacoes/{id}", delete(routes::notificacoes::excluir))
        .route("/busca", get(routes::notificacoes::busca))
        // CMS de quartos (admin) — conteúdo editorial, mídia e publicação
        .route("/cms/acomodacoes", get(routes::cms::listar))
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
        .route(
            "/api/v1/publico/reservas",
            post(routes::cms::publico_criar_reserva).route_layer(from_fn_with_state(
                IpRateLimit::novo(8, Duration::from_secs(60)),
                IpRateLimit::middleware,
            )),
        )
        // pagamento online — criação de checkout limitada por IP (cada
        // sessão Stripe custa uma chamada ao provedor)
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
        // webhook Stripe — fora do /api/v1 autenticado; a assinatura HMAC
        // do provedor é a credencial. Sem rate limit de IP (origem = Stripe).
        .route(
            "/api/v1/webhooks/stripe",
            post(routes::pagamentos_online::webhook_stripe),
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
        // pesquisa pós-estadia pública — token único por avaliação
        .route(
            "/api/v1/publico/avaliacoes/{token}",
            get(routes::comunicacao::avaliacao_get)
                .post(routes::comunicacao::avaliacao_post)
                .route_layer(from_fn_with_state(
                    IpRateLimit::novo(20, Duration::from_secs(60)),
                    IpRateLimit::middleware,
                )),
        )
        // LGPD público — descadastrar (link assinado) e direitos do titular
        // pelo token opaco da reserva.
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
        .route("/api/v1/midia/{id}", get(routes::cms::servir_midia))
        // scrape Prometheus — req/s, latência e status por rota
        .route(
            "/metrics",
            get(move || {
                let handle = metric_handle.clone();
                async move { handle.render() }
            }),
        )
        .nest("/api/v1", api)
        // span registra método + path apenas — query string pode carregar
        // credenciais (stream ticket) e filtros sensíveis; nunca vai a log.
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
        // DefaultPredicate já exclui text/event-stream — SSE não é comprimido.
        .layer(CompressionLayer::new())
        .layer(from_fn(mw::security_headers))
        .layer(cors_layer(&state.cors_origins))
        .layer(metric_layer)
        .with_state(state)
}
