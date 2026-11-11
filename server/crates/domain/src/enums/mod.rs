//! Enums fortemente tipados do domínio, agrupados por bounded context.
//!
//! Os discriminantes de 1 caractere preservam compatibilidade semântica com o
//! legado (`status IN ('p','i','c','f')`), mas como enums nativos do Postgres.

pub mod acesso;
pub mod caixa;
pub mod comunicacao;
pub mod estoque;
pub mod financeiro;
pub mod operacao;
pub mod pagamentos;
pub mod pdv;
pub mod reservas;

pub use acesso::*;
pub use caixa::*;
pub use comunicacao::*;
pub use estoque::*;
pub use financeiro::*;
pub use operacao::*;
pub use pagamentos::*;
pub use pdv::*;
pub use reservas::*;
