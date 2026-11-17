//! Serviços de aplicação — um por bounded context. Cada método é um caso de
//! uso: valida entrada, aplica regras, orquestra ports e produz auditoria.

pub mod acomodacoes;
pub mod atendimento;
pub mod auditoria;
pub mod auth;
pub mod busca;
pub mod cafe;
pub mod caixa;
pub mod clientes;
pub mod cms;
pub mod compras;
pub mod comunicacao;
pub mod concierge;
pub mod contratos;
pub mod dashboard;
pub mod documentos;
pub mod escalas;
pub mod estabelecimento;
pub mod estacionamento;
pub mod estoque;
pub mod financeiro;
pub mod frigobar;
pub mod funcionarios;
pub mod governanca;
pub mod impressoras;
pub mod integracoes;
pub mod lgpd;
pub mod manutencao;
pub mod notificacoes;
pub mod operadoras;
pub mod pagamentos;
pub mod pagamentos_online;
pub mod pdv;
pub mod pre_reserva;
pub mod preditivo;
pub mod reserva_busca;
pub mod reservas;
pub mod tesouraria;

pub use acomodacoes::AcomodacaoService;
pub use atendimento::AtendimentoService;
pub use auditoria::AuditoriaService;
pub use auth::AuthService;
pub use busca::BuscaService;
pub use cafe::CafeService;
pub use caixa::CaixaService;
pub use clientes::ClienteService;
pub use cms::CmsService;
pub use compras::ComprasService;
pub use comunicacao::{AvaliacoesService, ComunicacaoService, FidelidadeService};
pub use concierge::ConciergeService;
pub use contratos::ContratoService;
pub use dashboard::DashboardService;
pub use documentos::DocumentoService;
pub use escalas::EscalasService;
pub use estabelecimento::EstabelecimentoService;
pub use estacionamento::EstacionamentoService;
pub use estoque::EstoqueService;
pub use financeiro::FinanceiroService;
pub use frigobar::FrigobarService;
pub use funcionarios::FuncionarioService;
pub use governanca::GovernancaService;
pub use impressoras::ImpressoraService;
pub use integracoes::IntegracoesService;
pub use lgpd::LgpdService;
pub use manutencao::ManutencaoService;
pub use notificacoes::NotificacaoService;
pub use operadoras::OperadoraService;
pub use pagamentos::PagamentoService;
pub use pagamentos_online::PagamentosOnlineService;
pub use pdv::PdvService;
pub use pre_reserva::PreReservaService;
pub use preditivo::PreditivoService;
pub use reserva_busca::BuscaReservaService;
pub use reservas::{ReservaDeps, ReservaService};
pub use tesouraria::TesourariaService;
pub use zapi::ZApiService;

use std::sync::Arc;

/// Contêiner de DI — construído uma vez no bootstrap e compartilhado
/// via `Arc` no estado do axum.
pub struct Services {
    pub auth: Arc<AuthService>,
    pub clientes: Arc<ClienteService>,
    pub documentos: Arc<DocumentoService>,
    pub acomodacoes: Arc<AcomodacaoService>,
    pub cms: Arc<CmsService>,
    pub reservas: Arc<ReservaService>,
    /// Motor de busca público do site (datas+tolerância / flexível).
    pub reserva_busca: Arc<BuscaReservaService>,
    pub estoque: Arc<EstoqueService>,
    pub frigobar: Arc<FrigobarService>,
    pub estacionamento: Arc<EstacionamentoService>,
    pub pagamentos: Arc<PagamentoService>,
    pub pagamentos_online: Arc<PagamentosOnlineService>,
    pub funcionarios: Arc<FuncionarioService>,
    pub estabelecimento: Arc<EstabelecimentoService>,
    pub impressoras: Arc<ImpressoraService>,
    /// `None` sem `INTEGRACOES_MASTER_KEY` — rotas respondem 503
    /// explícito (nunca cofre improvisado).
    pub integracoes: Option<Arc<IntegracoesService>>,
    pub financeiro: Arc<FinanceiroService>,
    pub dashboard: Arc<DashboardService>,
    pub auditoria: Arc<AuditoriaService>,
    pub notificacoes: Arc<NotificacaoService>,
    pub busca: Arc<BuscaService>,
    pub tesouraria: Arc<TesourariaService>,
    pub caixa: Arc<CaixaService>,
    pub pdv: Arc<PdvService>,
    pub cafe: Arc<CafeService>,
    pub compras: Arc<ComprasService>,
    pub comunicacao: Arc<ComunicacaoService>,
    pub operadoras: Arc<OperadoraService>,
    pub contratos: Arc<ContratoService>,
    pub atendimento: Arc<AtendimentoService>,
    pub concierge: Arc<ConciergeService>,
    pub lgpd: Arc<LgpdService>,
    pub avaliacoes: Arc<AvaliacoesService>,
    pub fidelidade: Arc<FidelidadeService>,
    pub manutencao: Arc<ManutencaoService>,
    pub governanca: Arc<GovernancaService>,
    pub escalas: Arc<EscalasService>,
    pub preditivo: Arc<PreditivoService>,
    /// Webhook/provedor Z-API — `None` sem o cofre (master key ausente).
    pub zapi: Option<Arc<ZApiService>>,
}
pub mod zapi;
