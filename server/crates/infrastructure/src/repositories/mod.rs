//! Adapters PostgreSQL dos ports do domínio.

mod audit;
pub mod busca;
pub mod catalogo;
pub mod cms;
pub mod estoque;
pub mod impressora;
pub mod notificacao;
pub mod pessoas;
pub mod reserva;
pub mod suporte;

pub use busca::PgBuscaRepository;
pub use catalogo::{
    PgAcomodacaoRepository, PgEstabelecimentoRepository, PgEstacionamentoRepository,
    PgFormaPagamentoRepository, PgFrigobarRepository, PgQuartoRepository,
    PgTipoAcomodacaoRepository,
};
pub use cms::PgCmsRepository;
pub use estoque::PgEstoqueRepository;
pub use impressora::PgImpressoraRepository;
pub use notificacao::PgNotificacaoRepository;
pub use pessoas::{
    PgClienteRepository, PgDocumentoRepository, PgFuncionarioRepository, PgLogAcessoRepository,
    PgSessaoRepository,
};
pub use reserva::PgReservaRepository;
pub use suporte::{PgDashboardRepository, PgFinanceiroRepository, PgLogRepository};
