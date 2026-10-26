//! Entidades e agregados do domínio — estado persistido com invariantes.

pub mod acomodacao;
pub mod auditoria;
pub mod busca;
pub mod cliente;
pub mod cms;
pub mod documento;
pub mod estabelecimento;
pub mod estacionamento;
pub mod estoque;
pub mod frigobar;
pub mod funcionario;
pub mod impressora;
pub mod notificacao;
pub mod pagamento;
pub mod reserva;

pub use acomodacao::{Acomodacao, Quarto, TarifaHistorico, TipoAcomodacao};
pub use auditoria::{NovoLog, RegistroLog};
pub use busca::ItemBusca;
pub use cliente::Cliente;
pub use cms::{AcomodacaoCms, AcomodacaoCmsView, AcomodacaoMidia, AcomodacaoPublica, MidiaView};
pub use documento::ClienteDocumento;
pub use estabelecimento::{EnderecoEstabelecimento, Estabelecimento, LogoEstabelecimento};
pub use estacionamento::VagaEstacionamento;
pub use estoque::{CategoriaEstoque, ItemEstoque, MovimentoEstoque};
pub use frigobar::{Frigobar, ItemFrigobar};
pub use funcionario::{Funcionario, LogAcesso, SessaoRefresh};
pub use impressora::Impressora;
pub use notificacao::Notificacao;
pub use pagamento::FormaPagamento;
pub use reserva::{
    Acompanhante, AdicionalConsumo, Consumo, Fnrh, ItemConsumido, Reembolso, Reserva,
};
