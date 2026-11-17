//! DTOs de entrada/saída — contratos JSON da API `/api/v1`, organizados
//! por bounded context (espelho de `services/`).
//!
//! Campos em `snake_case`, datas ISO-8601, dinheiro como `Decimal`
//! (aceita número ou string; sempre serializado com 2 casas).
//! `de` concentra os helpers de desserialização tolerante (formato BR,
//! inteiros achatados em query string).

mod de;

pub mod acomodacoes;
pub mod auth;
pub mod cafe;
pub mod caixa;
pub mod clientes;
pub mod cms;
pub mod compras;
pub mod comum;
pub mod comunicacao;
pub mod dashboard;
pub mod estabelecimento;
pub mod estacionamento;
pub mod estoque;
pub mod frigobar;
pub mod funcionarios;
pub mod impressoras;
pub mod integracoes;
pub mod operacao;
pub mod pagamentos_online;
pub mod pdv;
pub mod reservas;
pub mod tesouraria;

pub use acomodacoes::*;
pub use auth::*;
pub use cafe::*;
pub use caixa::*;
pub use clientes::*;
pub use cms::*;
pub use compras::*;
pub use comum::*;
pub use comunicacao::*;
pub use dashboard::*;
pub use estabelecimento::*;
pub use estacionamento::*;
pub use estoque::*;
pub use frigobar::*;
pub use funcionarios::*;
pub use impressoras::*;
pub use integracoes::*;
pub use operacao::*;
pub use pagamentos_online::*;
pub use pdv::*;
pub use reservas::*;
pub use tesouraria::*;
