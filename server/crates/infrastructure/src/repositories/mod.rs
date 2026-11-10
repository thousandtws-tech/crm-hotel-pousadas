//! Adapters PostgreSQL dos ports do domínio.

mod audit;
pub mod busca;
pub mod cafe;
pub mod caixa;
pub mod catalogo;
pub mod cms;
pub mod compras;
pub mod comunicacao;
pub mod estoque;
pub mod impressora;
pub mod notificacao;
pub mod operacao;
pub mod pagamento;
pub mod pdv;
pub mod pessoas;
pub mod preditivo;
pub mod reserva;
pub mod suporte;
pub mod tesouraria;

pub use busca::PgBuscaRepository;
pub use cafe::PgCafeRepository;
pub use caixa::PgCaixaRepository;
pub use catalogo::{
    PgAcomodacaoRepository, PgEstabelecimentoRepository, PgEstacionamentoRepository,
    PgFormaPagamentoRepository, PgFrigobarRepository, PgQuartoRepository,
    PgTipoAcomodacaoRepository,
};
pub use cms::PgCmsRepository;
pub use compras::PgComprasRepository;
pub use comunicacao::{
    PgAutomacaoRepository, PgAvaliacaoRepository, PgFidelidadeRepository, PgFilaEnvio,
    PgInnaRepository, PgPushRepository,
};
pub use estoque::PgEstoqueRepository;
pub use impressora::PgImpressoraRepository;
pub use notificacao::PgNotificacaoRepository;
pub use operacao::{PgEscalaRepository, PgGovernancaRepository, PgManutencaoRepository};
pub use pagamento::PgPagamentoRepository;
pub use pdv::PgPdvRepository;
pub use pessoas::{
    PgClienteRepository, PgDocumentoRepository, PgFuncionarioRepository, PgLogAcessoRepository,
    PgSessaoRepository,
};
pub use preditivo::PgPreditivoRepository;
pub use reserva::PgReservaRepository;
pub use suporte::{PgDashboardRepository, PgFinanceiroRepository, PgLogRepository};
pub use tesouraria::PgTesourariaRepository;
