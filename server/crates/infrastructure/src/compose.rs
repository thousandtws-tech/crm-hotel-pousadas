//! Composition root compartilhado — `clarituz-api serve` e os testes de
//! integração montam o mesmo grafo de dependências, então o que o teste
//! exercita é a fiação real de produção, não uma réplica divergente.

use crate::escpos::SpoolImpressora;
use crate::eventos::{spawn_aviso_persister, EventBus};
use crate::jwt::JwtIssuer;
use crate::password::Argon2Hasher;
use crate::repositories::*;
use clarituz_application::services::*;
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
        .map(|k| Arc::new(crate::stripe::StripeGateway::new(k.clone())) as _);
    // consumer do bus → histórico persistido (inbox/badges)
    let notif_repo = Arc::new(PgNotificacaoRepository::new(pool.clone()));
    spawn_aviso_persister(eventos.clone(), notif_repo.clone());

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
        reservas: Arc::new(ReservaService::new(ReservaDeps {
            reservas: reserva_repo.clone(),
            acomodacoes: acom_repo.clone(),
            clientes: clientes_repo,
            pagamentos: pag_repo.clone(),
            estabelecimentos: Arc::new(PgEstabelecimentoRepository::new(pool.clone())),
            impressoras: impressora_repo.clone(),
            impressora: impressora_gw.clone(),
            auth: auth.clone(),
            eventos: publisher.clone(),
            acompanhantes: reserva_repo.clone(),
            fnrh: reserva_repo.clone(),
            hold_minutos: settings.hold_minutos,
        })),
        pagamentos_online: Arc::new(PagamentosOnlineService::new(
            pag_online_repo,
            reserva_repo,
            gateway,
            publisher.clone(),
            settings.sinal_percentual,
            settings.hold_minutos,
            settings.stripe_success_url.clone(),
            settings.stripe_cancel_url.clone(),
        )),
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
    };

    BuiltServices {
        services,
        auth,
        issuer,
    }
}
