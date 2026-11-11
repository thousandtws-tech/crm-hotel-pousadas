//! Value objects validados na fronteira — construção impossível em estado
//! inválido.

pub mod cpf;
pub mod email;
pub mod periodo;

pub use cpf::Cpf;
pub use email::Email;
pub use periodo::PeriodoEstadia;
