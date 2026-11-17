//! Adapters PostgreSQL dos ports do domínio.

mod audit;
pub mod busca;
pub mod cafe;
pub mod caixa;
pub mod catalogo;
pub mod cms;
pub mod compras;
pub mod comunicacao;
pub mod contrato;
pub mod estoque;
pub mod fiscal;
pub mod impressora;
pub mod integracao;
pub mod notificacao;
pub mod operacao;
pub mod operadora;
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
    PgAtendimentoRepository, PgAutomacaoRepository, PgAvaliacaoRepository, PgComunicacaoEventos,
    PgFidelidadeRepository, PgFilaEnvio, PgInnaRepository, PgLgpdRepository,
    PgPreReservaRepository, PgPushRepository,
};
pub use contrato::PgContratoRepository;
pub use estoque::PgEstoqueRepository;
pub use fiscal::PgFiscalRepository;
pub use impressora::PgImpressoraRepository;
pub use integracao::PgIntegracaoRepository;
pub use notificacao::PgNotificacaoRepository;
pub use operacao::{PgEscalaRepository, PgGovernancaRepository, PgManutencaoRepository};
pub use operadora::PgOperadoraRepository;
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
pub mod verificacao;
pub use verificacao::PgVerificacaoRepository;
