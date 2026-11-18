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
    let cargos = Arc::new(CargosService::new(Arc::new(PgCargoRepository::new(
        pool.clone(),
    ))));
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
    let cms_repo = Arc::new(PgCmsRepository::new(pool.clone()));
    let pag_online_repo = Arc::new(PgPagamentoRepository::new(pool.clone()));
    let impressora_repo = Arc::new(PgImpressoraRepository::new(pool.clone()));
    let impressora_gw: Arc<dyn ImpressoraGateway> = Arc::new(SpoolImpressora::new(pool.clone()));
    let publisher: Arc<dyn EventoPublisher> = Arc::new(eventos.clone());

    let gateway: Option<Arc<dyn clarituz_domain::ports::PaymentGateway>> = settings
        .stripe_secret_key
        .as_ref()
        .map(|k| Arc::new(crate::integrations::stripe::StripeGateway::new(k.clone())) as _);

    let integracoes_repo = Arc::new(PgIntegracaoRepository::new(pool.clone()));

    let vault: Option<Arc<dyn clarituz_domain::ports::CredentialVault>> =
        settings.integracoes_master_key.as_deref().and_then(|k| {
            crate::security::vault::AesCredentialVault::new(k)
                .map(|v| Arc::new(v) as Arc<dyn clarituz_domain::ports::CredentialVault>)
                .map_err(|e| tracing::warn!(erro = %e, "vault de integrações indisponível"))
                .ok()
        });

    let gateway_resolver: Option<Arc<dyn clarituz_domain::ports::GatewayResolver>> =
        vault.as_ref().map(|v| {
            Arc::new(crate::integrations::resolver::PgGatewayResolver::new(
                integracoes_repo.clone() as Arc<dyn clarituz_domain::ports::IntegracaoRepository>,
                v.clone(),
                gateway.clone(),
            )) as Arc<dyn clarituz_domain::ports::GatewayResolver>
        });

    let notif_repo = Arc::new(PgNotificacaoRepository::new(pool.clone()));
    spawn_aviso_persister(eventos.clone(), notif_repo.clone());

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
    // WhatsApp legados (env) — fallback e alvo de seleção explícita.
    let legados_wa: Vec<Arc<dyn clarituz_domain::ports::Emissor>> = emissores
        .iter()
        .filter(|e| e.canal() == clarituz_domain::enums::CanalEnvio::Whatsapp)
        .cloned()
        .collect();
    let com_eventos_repo = Arc::new(PgComunicacaoEventos::new(pool.clone()));
    let com_resolver: Option<Arc<dyn clarituz_domain::ports::ComunicacaoResolver>> =
        vault.as_ref().map(|v| {
            Arc::new(
                crate::integrations::resolver_whatsapp::PgComunicacaoResolver::new(
                    integracoes_repo.clone()
                        as Arc<dyn clarituz_domain::ports::IntegracaoRepository>,
                    v.clone(),
                    legados_wa,
                ),
            ) as Arc<dyn clarituz_domain::ports::ComunicacaoResolver>
        });

    let fila_envio_repo = Arc::new(PgFilaEnvio::new(pool.clone()));
    let fila_envio_repo2 = fila_envio_repo.clone();
    let avaliacao_repo = Arc::new(PgAvaliacaoRepository::new(pool.clone()));
    let fidelidade_repo = Arc::new(PgFidelidadeRepository::new(pool.clone()));
    let automacao_repo = Arc::new(PgAutomacaoRepository::new(pool.clone()));

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
        Arc::new(PgCampanhaRepository::new(pool.clone())),
        com_resolver.clone(),
    ));

    // Distribuição (Channex) — antes do ReservaService: mutações de
    // estoque (reserva/bloqueio) enfileiram outbox via `dist`.
    let distribuicao_svc = vault.as_ref().map(|v| {
        let factory: clarituz_application::services::channex::ChannexFactory =
            Arc::new(|api_key, amb| {
                Arc::new(crate::integrations::channex::ChannexCliente::new(
                    api_key, amb,
                )) as Arc<dyn clarituz_domain::ports::ProvedorDistribuicao>
            });
        Arc::new(clarituz_application::services::ChannexService::new(
            Arc::new(PgDistribuicaoRepository::new(pool.clone()))
                as Arc<dyn clarituz_domain::ports::DistribuicaoRepository>,
            integracoes_repo.clone() as Arc<dyn clarituz_domain::ports::IntegracaoRepository>,
            reserva_repo.clone(),
            acom_repo.clone(),
            clientes_repo.clone(),
            v.clone(),
            factory,
        ))
    });

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
        dist: distribuicao_svc.clone(),
        comunicacao: Some(comunicacao_svc.clone()),
    }));
    let pagamentos_online_svc = Arc::new(PagamentosOnlineService::new(
        pag_online_repo.clone(),
        reserva_repo.clone(),
        gateway,
        gateway_resolver.clone(),
        Some(integracoes_repo.clone() as Arc<dyn clarituz_domain::ports::IntegracaoRepository>),
        publisher.clone(),
        settings.sinal_percentual,
        settings.hold_minutos,
        settings.stripe_success_url.clone(),
        settings.stripe_cancel_url.clone(),
        settings.public_api_url.clone(),
        Some(comunicacao_svc.clone()),
    ));
    // Fiscal (Spedy) — antes das integrações: o teste de conexão do
    // card delega à consulta da empresa remota. O repo é compartilhado
    // com o monitor de falhas (varredura independe do vault).
    let fiscal_repo = Arc::new(PgFiscalRepository::new(pool.clone()));
    let fiscal_svc = vault.as_ref().map(|v| {
        let factory: clarituz_application::services::fiscal::SpedyFactory =
            Arc::new(|api_key, amb| {
                Arc::new(crate::integrations::spedy::SpedyCliente::new(api_key, amb))
                    as Arc<dyn clarituz_domain::ports::ProvedorFiscal>
            });
        Arc::new(FiscalService::new(
            fiscal_repo.clone() as Arc<dyn clarituz_domain::ports::FiscalRepository>,
            integracoes_repo.clone() as Arc<dyn clarituz_domain::ports::IntegracaoRepository>,
            v.clone(),
            reserva_repo.clone(),
            clientes_repo.clone(),
            Arc::new(PgEstabelecimentoRepository::new(pool.clone())),
            factory,
        ))
    });
    // Verificação (Didit) — antes das integrações: o teste de conexão
    // do card delega à leitura autenticada no provedor.
    let verificacao_svc = vault.as_ref().map(|v| {
        let factory: clarituz_application::services::verificacao::DiditFactory =
            Arc::new(|api_key| {
                Arc::new(crate::integrations::didit::DiditCliente::new(api_key))
                    as Arc<dyn clarituz_domain::ports::ProvedorVerificacao>
            });
        Arc::new(clarituz_application::services::VerificacaoService::new(
            Arc::new(crate::persistence::repositories::PgVerificacaoRepository::new(pool.clone()))
                as Arc<dyn clarituz_domain::ports::VerificacaoRepository>,
            integracoes_repo.clone() as Arc<dyn clarituz_domain::ports::IntegracaoRepository>,
            funcionarios.clone(),
            v.clone(),
            factory,
        ))
    });
    let integracoes_svc = vault.map(|v| {
        Arc::new(IntegracoesService::new(
            integracoes_repo.clone() as Arc<dyn clarituz_domain::ports::IntegracaoRepository>,
            v,
            gateway_resolver.clone().unwrap(),
            com_resolver.clone(),
            Some(com_eventos_repo.clone()
                as Arc<dyn clarituz_domain::ports::ComunicacaoEventoRepository>),
            fiscal_svc.clone(),
            verificacao_svc.clone(),
            distribuicao_svc.clone(),
            pag_online_repo as Arc<dyn clarituz_domain::ports::PagamentoRepository>,
            settings.stripe_secret_key.is_some(),
        ))
    });
    let pre_reserva_svc = Arc::new(PreReservaService::new(
        Arc::new(PgPreReservaRepository::new(pool.clone())),
        reserva_repo.clone(),
        reservas_svc.clone(),
        pagamentos_online_svc.clone(),
        comunicacao_svc.clone(),
        settings.sinal_percentual,
    ));

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

    // Z-API — webhook + provedor; precisa do cofre pra abrir segredos.
    let zapi_svc = com_resolver.clone().map(|com| {
        Arc::new(ZApiService::new(
            com,
            com_eventos_repo.clone()
                as Arc<dyn clarituz_domain::ports::ComunicacaoEventoRepository>,
            fila_envio_repo.clone(),
            concierge_svc.clone(),
            integracoes_repo.clone() as Arc<dyn clarituz_domain::ports::IntegracaoRepository>,
        ))
    });

    // Infobip — DLR do canal SMS; mesma dependência do cofre.
    let infobip_svc = com_resolver.clone().map(|com| {
        Arc::new(InfobipService::new(
            com,
            com_eventos_repo.clone()
                as Arc<dyn clarituz_domain::ports::ComunicacaoEventoRepository>,
            fila_envio_repo.clone(),
        ))
    });
    let lgpd_svc = Arc::new(LgpdService::new(
        lgpd_repo.clone(),
        publisher.clone(),
        logs.clone(),
    ));

    // Monitor de falhas operacionais — só lê tabelas, funciona sem cofre.
    let alertas_svc = Arc::new(AlertaFalhaService::new(
        fila_envio_repo.clone(),
        fiscal_repo.clone(),
        Arc::new(PgAlertaOperacionalRepository::new(pool.clone())),
        publisher.clone(),
    ));

    let contratos_svc = Arc::new(ContratoService::new(Arc::new(PgContratoRepository::new(
        pool.clone(),
    ))));

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
        cms: Arc::new(CmsService::new(cms_repo.clone(), acom_repo.clone())),
        reservas: reservas_svc,
        reserva_busca: Arc::new(BuscaReservaService::new(reserva_repo.clone(), cms_repo)),
        pagamentos_online: pagamentos_online_svc,
        integracoes: integracoes_svc,
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
        funcionarios: Arc::new(FuncionarioService::new(
            funcionarios,
            hasher,
            cargos.clone(),
        )),
        cargos,
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
        alertas: alertas_svc,
        zapi: zapi_svc,
        infobip: infobip_svc,
        fiscal: fiscal_svc,
        verificacao: verificacao_svc,
        distribuicao: distribuicao_svc,
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
