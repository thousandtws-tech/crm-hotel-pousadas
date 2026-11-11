//! Bootstrap do processo — definição da CLI, comandos operacionais e
//! subida do servidor HTTP.

pub mod cli;
mod commands;
mod serve;

pub use commands::create_admin;
pub use serve::serve;
