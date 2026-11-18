//! Value objects validados na fronteira — construção impossível em estado
//! inválido.

pub mod cpf;
pub mod email;
pub mod infobip_url;
pub mod periodo;
pub mod sms;
pub mod telefone;

pub use cpf::Cpf;
pub use email::Email;
pub use periodo::PeriodoEstadia;
