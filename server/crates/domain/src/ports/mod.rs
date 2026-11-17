//! Ports — contratos de saída do domínio (Hexagonal Architecture).
//!
//! Cada método expressa uma *operação de negócio*, não um CRUD nu: as
//! implementações executam a transação completa (entidade + efeitos
//! colaterais atômicos como `log`, `consumo`, movimentos de estoque).

pub mod auth;
pub mod cafe;
pub mod caixa;
pub mod catalogo;
pub mod cms;
pub mod compras;
pub mod comunicacao;
pub mod contrato;
pub mod estoque;
pub mod eventos;
pub mod impressao;
pub mod integracoes;
pub mod operacao;
pub mod operadora;
pub mod pagamentos;
pub mod pdv;
pub mod pessoas;
pub mod preditivo;
pub mod reserva;
pub mod storage;
pub mod suporte;
pub mod tesouraria;

pub use auth::*;
pub use cafe::*;
pub use caixa::*;
pub use catalogo::*;
pub use cms::*;
pub use compras::*;
pub use comunicacao::*;
pub use contrato::*;
pub use estoque::*;
pub use eventos::*;
pub use impressao::*;
pub use integracoes::*;
pub use operacao::*;
pub use operadora::*;
pub use pagamentos::*;
pub use pdv::*;
pub use pessoas::*;
pub use reserva::*;
pub use storage::*;
pub use suporte::*;
pub use tesouraria::*;
