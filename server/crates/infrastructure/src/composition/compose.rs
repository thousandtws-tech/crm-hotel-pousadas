//! Composition root compartilhado — `clarituz-api serve` e os testes de
//! integração montam o mesmo grafo de dependências, então o que o teste
//! exercita é a fiação real de produção, não uma réplica divergente.

use crate::messaging::eventos::{spawn_aviso_persister, EventBus};
use crate::persistence::repositories::*;
use crate::printing::escpos::SpoolImpressora;
use crate::security::jwt::JwtIssuer;
use crate::security::password::Argon2Hasher;

use clarituz_application::services::*;
use clarituz_application::services::{
    EscalasService, GovernancaService, ManutencaoService, PreditivoService,
};
use clarituz_application::Services;
use clarituz_domain::ports::{
    EventoPublisher, FuncionarioRepository, ImpressoraGateway, PasswordHasher, TokenIssuer,
};
use clarituz_shared::Settings;
use sqlx::PgPool;
use std::sync::Arc;

/// Grafo montado: os serviços de aplicação + as peças que a camada HTTP
/// consome direto (issuer para o extractor e auth para `create-admin`).
pub struct BuiltServices {
    pub services: Services,
    pub auth: Arc<AuthService>,
    pub issuer: Arc<dyn TokenIssuer>,
}

pub fn build_services(settings: &Settings, pool: &PgPool, eventos: &EventBus) -> BuiltServices {
    let funcionarios: Arc<dyn FuncionarioRepository> =
        Arc::new(PgFuncionarioRepository::new(pool.clone()));
    let sessoes = Arc::new(PgSessaoRepository::new(pool.clone()));
    let acessos = Arc::new(PgLogAcessoRepository::new(pool.clone()));
    let logs = Arc::new(PgLogRepository::new(pool.clone()));
    let hasher: Arc<dyn PasswordHasher> = Arc::new(Argon2Hasher::new());
    let issuer: Arc<dyn TokenIssuer> = Arc::new(JwtIssuer::new(&settings.jwt_secret));

    let auth = Arc::new(AuthService::new(
        funcionarios.clone(),
        sessoes,
        acessos,
        logs.clone(),
        hasher.clone(),
        issuer.clone(),
        settings.jwt_ttl_secs,
        settings.refresh_ttl_secs,
    ));

    let clientes_repo = Arc::new(PgClienteRepository::new(pool.clone()));
    let acom_repo = Arc::new(PgAcomodacaoRepository::new(pool.clone()));
    let pag_repo = Arc::new(PgFormaPagamentoRepository::new(pool.clone()));
    let reserva_repo = Arc::new(PgReservaRepository::new(pool.clone()));
    let pag_online_repo = Arc::new(PgPagamentoRepository::new(pool.clone()));
    let impressora_repo = Arc::new(PgImpressoraRepository::new(pool.clone()));
    let impressora_gw: Arc<dyn ImpressoraGateway> = Arc::new(SpoolImpressora::new(pool.clone()));
    let publisher: Arc<dyn EventoPublisher> = Arc::new(eventos.clone());

    // Gateway Stripe — sem `STRIPE_SECRET_KEY` o serviço sobe normalmente
    // e o checkout público responde erro explícito (degradação segura).
    let gateway: Option<Arc<dyn clarituz_domain::ports::PaymentGateway>> = settings
        .stripe_secret_key
        .as_ref()
        .map(|k| Arc::new(crate::integrations::stripe::StripeGateway::new(k.clone())) as _);
    // consumer do bus → histórico persistido (inbox/badges)
    let notif_repo = Arc::new(PgNotificacaoRepository::new(pool.clone()));
    spawn_aviso_persister(eventos.clone(), notif_repo.clone());

    // Emissores externos — cada um entra só com as credenciais presentes.
    // Sem credencial, o item da fila falha com backoff (degradação segura,
    // igual ao gateway Stripe ausente).
    let mut emissores: Vec<Arc<dyn clarituz_domain::ports::Emissor>> = Vec::new();
    if let Some(key) = settings.resend_api_key.as_ref() {
        emissores.push(Arc::new(crate::integrations::senders::ResendEmissor::new(
            key.clone(),
            settings.email_remetente.clone(),
        )));
    }
    if let (Some(tok), Some(phone)) = (
        settings.whatsapp_token.as_ref(),
        settings.whatsapp_phone_id.as_ref(),
    ) {
        emissores.push(Arc::new(crate::integrations::senders::MetaWaEmissor::new(
            tok.clone(),
            phone.clone(),
        )));
    }
    if let (Some(url), Some(key), Some(sid)) = (
        settings.waakg_url.as_ref(),
        settings.waakg_api_key.as_ref(),
        settings.waakg_session_id.as_ref(),
    ) {
        emissores.push(Arc::new(crate::integrations::senders::WaAkgEmissor::new(
            url,
            key.clone(),
            sid.clone(),
        )));
    }
    if let (Some(pem), Some(pub_b64)) = (
        settings.vapid_private_pem.as_ref(),
        settings.vapid_public_b64.as_ref(),
    ) {
        emissores.push(Arc::new(
            crate::integrations::senders::VapidPushEmissor::new(
                pem.clone(),
                pub_b64.clone(),
                settings.vapid_contato.clone(),
            ),
        ));
    }
    let fila_envio_repo = Arc::new(PgFilaEnvio::new(pool.clone()));
    let fila_envio_repo2 = fila_envio_repo.clone();
    let avaliacao_repo = Arc::new(PgAvaliacaoRepository::new(pool.clone()));
    let fidelidade_repo = Arc::new(PgFidelidadeRepository::new(pool.clone()));
    let automacao_repo = Arc::new(PgAutomacaoRepository::new(pool.clone()));

    // Inná Concierge — cliente HTTP do serviço Python só entra com
    // MARIA_URL + INNA_INTERNAL_KEY; sem eles o concierge responde o
    // fallback seguro e escala pra recepção (degradação controlada).
    let maria_ia: Option<Arc<dyn clarituz_domain::ports::ConciergeIa>> = settings
        .maria_url
        .as_ref()
        .zip(settings.inna_internal_key.as_ref())
        .map(|(u, k)| Arc::new(crate::integrations::maria::MariaClient::new(u, k.clone())) as _);

    let lgpd_repo = Arc::new(PgLgpdRepository::new(pool.clone()));
    let comunicacao_svc = Arc::new(ComunicacaoService::new(
        fila_envio_repo.clone(),
        Arc::new(PgPushRepository::new(pool.clone())),
        avaliacao_repo.clone(),
        automacao_repo.clone(),
        emissores,
        publisher.clone(),
        &settings.site_base,
        settings.public_api_url.clone(),
        settings.jwt_secret.clone(),
        settings.pousada_nome.clone(),
        lgpd_repo.clone(),
    ));
    // Reservas + pagamentos online sobem antes do concierge: a
    // pré-reserva por WhatsApp (fluxo determinístico, sem LLM) consome
    // os dois — cria o hold via `criar_reserva_site` e o link de sinal
    // via `criar_checkout_publico`.
    let reservas_svc = Arc::new(ReservaService::new(ReservaDeps {
        reservas: reserva_repo.clone(),
        acomodacoes: acom_repo.clone(),
        clientes: clientes_repo.clone(),
        pagamentos: pag_repo.clone(),
        estabelecimentos: Arc::new(PgEstabelecimentoRepository::new(pool.clone())),
        impressoras: impressora_repo.clone(),
        impressora: impressora_gw.clone(),
        auth: auth.clone(),
        eventos: publisher.clone(),
        acompanhantes: reserva_repo.clone(),
        fnrh: reserva_repo.clone(),
        lgpd: lgpd_repo.clone(),
        fila: fila_envio_repo.clone(),
        contratos: Arc::new(PgContratoRepository::new(pool.clone())),
        hold_minutos: settings.hold_minutos,
    }));
    let pagamentos_online_svc = Arc::new(PagamentosOnlineService::new(
        pag_online_repo,
        reserva_repo.clone(),
        gateway,
        publisher.clone(),
        settings.sinal_percentual,
        settings.hold_minutos,
        settings.stripe_success_url.clone(),
        settings.stripe_cancel_url.clone(),
    ));
    let pre_reserva_svc = Arc::new(PreReservaService::new(
        Arc::new(PgPreReservaRepository::new(pool.clone())),
        reserva_repo.clone(),
        reservas_svc.clone(),
        pagamentos_online_svc.clone(),
        comunicacao_svc.clone(),
        settings.sinal_percentual,
    ));
    // Roteamento — protocolos por setor com SLA; a escalada da Inná e a
    // tela de fila compartilham o mesmo service.
    let atendimento_svc = Arc::new(AtendimentoService::new(
        Arc::new(PgAtendimentoRepository::new(pool.clone())),
        comunicacao_svc.clone(),
        settings.atendimento_sla_aceite_min,
        &settings.atendimento_horario,
    ));
    let concierge_svc = Arc::new(ConciergeService::new(
        automacao_repo,
        Arc::new(PgInnaRepository::new(pool.clone())),
        Arc::new(PgEstabelecimentoRepository::new(pool.clone())),
        fila_envio_repo.clone(),
        comunicacao_svc.clone(),
        maria_ia,
        settings.whatsapp_verify_token.clone(),
        settings.whatsapp_app_secret.clone(),
        lgpd_repo.clone(),
        pre_reserva_svc,
        atendimento_svc.clone(),
    ));
    let lgpd_svc = Arc::new(LgpdService::new(
        lgpd_repo.clone(),
        publisher.clone(),
        logs.clone(),
    ));

    let contratos_svc = Arc::new(ContratoService::new(Arc::new(PgContratoRepository::new(
        pool.clone(),
    ))));

    // B2B — operadoras/canal indireto com extranet por token e tarifa net.
    let operadoras_svc = Arc::new(OperadoraService::new(
        Arc::new(PgOperadoraRepository::new(pool.clone())),
        reserva_repo.clone(),
        reservas_svc.clone(),
        clientes_repo.clone(),
        acom_repo.clone(),
        publisher.clone(),
    ));

    let services = Services {
        auth: auth.clone(),
        clientes: Arc::new(ClienteService::new(clientes_repo.clone())),
        documentos: Arc::new(DocumentoService::new(
            Arc::new(PgDocumentoRepository::new(pool.clone())),
            clientes_repo.clone(),
        )),
        acomodacoes: Arc::new(AcomodacaoService::new(
            acom_repo.clone(),
            Arc::new(PgTipoAcomodacaoRepository::new(pool.clone())),
            Arc::new(PgQuartoRepository::new(pool.clone())),
        )),
        cms: Arc::new(CmsService::new(
            Arc::new(PgCmsRepository::new(pool.clone())),
            acom_repo.clone(),
        )),
        reservas: reservas_svc,
        pagamentos_online: pagamentos_online_svc,
        estoque: Arc::new(
            EstoqueService::new(Arc::new(PgEstoqueRepository::new(pool.clone())))
                .com_etiquetas(impressora_repo.clone(), impressora_gw.clone()),
        ),
        frigobar: Arc::new(FrigobarService::new(
            Arc::new(PgFrigobarRepository::new(pool.clone())),
            acom_repo,
        )),
        estacionamento: Arc::new(EstacionamentoService::new(Arc::new(
            PgEstacionamentoRepository::new(pool.clone()),
        ))),
        pagamentos: Arc::new(PagamentoService::new(pag_repo)),
        funcionarios: Arc::new(FuncionarioService::new(funcionarios, hasher)),
        estabelecimento: Arc::new(EstabelecimentoService::new(Arc::new(
            PgEstabelecimentoRepository::new(pool.clone()),
        ))),
        impressoras: Arc::new(ImpressoraService::new(impressora_repo, impressora_gw)),
        financeiro: Arc::new(FinanceiroService::new(Arc::new(
            PgFinanceiroRepository::new(pool.clone()),
        ))),
        dashboard: Arc::new(DashboardService::new(Arc::new(PgDashboardRepository::new(
            pool.clone(),
        )))),
        auditoria: Arc::new(AuditoriaService::new(logs)),
        notificacoes: Arc::new(NotificacaoService::new(notif_repo)),
        busca: Arc::new(BuscaService::new(Arc::new(PgBuscaRepository::new(
            pool.clone(),
        )))),
        tesouraria: Arc::new(TesourariaService::new(Arc::new(
            PgTesourariaRepository::new(pool.clone()),
        ))),
        caixa: Arc::new(CaixaService::new(Arc::new(PgCaixaRepository::new(
            pool.clone(),
        )))),
        pdv: Arc::new(PdvService::new(Arc::new(PgPdvRepository::new(
            pool.clone(),
        )))),
        cafe: Arc::new(CafeService::new(Arc::new(PgCafeRepository::new(
            pool.clone(),
        )))),
        compras: Arc::new(ComprasService::new(
            Arc::new(PgComprasRepository::new(pool.clone())),
            Arc::new(PgEstoqueRepository::new(pool.clone())),
        )),
        comunicacao: comunicacao_svc,
        operadoras: operadoras_svc,
        contratos: contratos_svc,
        atendimento: atendimento_svc,
        concierge: concierge_svc,
        lgpd: lgpd_svc,
        avaliacoes: Arc::new(AvaliacoesService::new(avaliacao_repo)),
        fidelidade: Arc::new(FidelidadeService::new(fidelidade_repo)),
        manutencao: Arc::new(ManutencaoService::new(
            Arc::new(PgManutencaoRepository::new(pool.clone())),
            fila_envio_repo2.clone(),
            publisher.clone(),
        )),
        governanca: Arc::new(GovernancaService::new(
            Arc::new(PgGovernancaRepository::new(pool.clone())),
            publisher.clone(),
        )),
        escalas: Arc::new(EscalasService::new(Arc::new(PgEscalaRepository::new(
            pool.clone(),
        )))),
        preditivo: Arc::new(PreditivoService::new(Arc::new(PgPreditivoRepository::new(
            pool.clone(),
        )))),
    };

    BuiltServices {
        services,
        auth,
        issuer,
    }
}
