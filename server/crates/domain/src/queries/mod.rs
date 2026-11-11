//! Read models — projeções de consulta (joins, agregações, relatórios),
//! agrupadas por bounded context.
//! Separação CQRS-lite: entidades escrevem, estas structs respondem leituras.

pub mod cafe;
pub mod caixa;
pub mod compras;
pub mod dashboard;
pub mod estoque;
pub mod financeiro;
pub mod operacao;
pub mod pdv;
pub mod reservas;
pub mod tesouraria;

pub use cafe::*;
pub use caixa::*;
pub use compras::*;
pub use dashboard::*;
pub use estoque::*;
pub use financeiro::*;
pub use operacao::*;
pub use pdv::*;
pub use reservas::*;
pub use tesouraria::*;
