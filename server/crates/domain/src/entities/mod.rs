//! Entidades e agregados do domínio — estado persistido com invariantes.

pub mod acomodacao;
pub mod auditoria;
pub mod busca;
pub mod cafe;
pub mod caixa;
pub mod cliente;
pub mod cms;
pub mod compras;
pub mod comunicacao;
pub mod documento;
pub mod estabelecimento;
pub mod estacionamento;
pub mod estoque;
pub mod financeiro;
pub mod frigobar;
pub mod funcionario;
pub mod impressora;
pub mod notificacao;
pub mod operacao;
pub mod pagamento;
pub mod pdv;
pub mod preditivo;
pub mod reserva;

pub use acomodacao::{Acomodacao, Quarto, TarifaHistorico, TarifaOcupacao, TipoAcomodacao};
pub use auditoria::{NovoLog, RegistroLog};
pub use busca::ItemBusca;
pub use cafe::CafePresenca;
pub use caixa::{CaixaMovimento, CaixaTurno};
pub use cliente::Cliente;
pub use cms::{AcomodacaoCms, AcomodacaoCmsView, AcomodacaoMidia, AcomodacaoPublica, MidiaView};
pub use compras::{Fornecedor, PedidoCompra, PedidoCompraItem};
pub use comunicacao::*;
pub use documento::ClienteDocumento;
pub use estabelecimento::{EnderecoEstabelecimento, Estabelecimento, LogoEstabelecimento};
pub use estacionamento::VagaEstacionamento;
pub use estoque::{
    CategoriaEstoque, ConversaoUnidade, FichaTecnica, ItemEstoque, MovimentoEstoque, NfeImport,
};
pub use financeiro::{
    calcular_split, BaixaLancamento, Conciliacao, ContaFinanceira, ExtratoItem, Lancamento,
    PlanoConta, SplitPayment, SplitValor, TributoApuracao, TributoConfig,
};
pub use frigobar::{Frigobar, ItemFrigobar};
pub use funcionario::{Funcionario, LogAcesso, SessaoRefresh};
pub use impressora::{ImpressaoJob, Impressora, ImpressoraDescoberta};
pub use notificacao::Notificacao;
pub use operacao::*;
pub use pagamento::{
    FormaPagamento, NovaAuditoriaPagamento, PagamentoOnline, ReembolsoPagamento,
    TentativaPagamento, WebhookEvento,
};
pub use pdv::{PdvComanda, PdvComandaItem, PdvComissao, PdvGarcom, PdvMesa};
pub use preditivo::*;
pub use reserva::{
    Acompanhante, AdicionalConsumo, Bloqueio, Consumo, Fnrh, Grupo, GrupoUnidade, GrupoUnidadeView,
    ItemConsumido, Reembolso, Reserva,
};
