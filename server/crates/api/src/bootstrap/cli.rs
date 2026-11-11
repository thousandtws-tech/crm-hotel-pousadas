//! Definição da CLI operacional do binário `clarituz-api`.

use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "clarituz-api", about = "Backend do CRM da pousada")]
pub struct Cli {
    #[command(subcommand)]
    pub cmd: Option<Cmd>,
}

#[derive(Subcommand)]
pub enum Cmd {
    /// Sobe o servidor HTTP (default).
    Serve,
    /// Aplica as migrations do banco e sai.
    Migrate,
    /// Cria um funcionário administrador (bootstrap/seed).
    CreateAdmin {
        #[arg(long)]
        login: String,
        #[arg(long)]
        nome: String,
        #[arg(long)]
        senha: String,
        #[arg(long, default_value_t = 1)]
        nivel: i16,
    },
    /// Diagnóstico do object store — lista buckets, garante o bucket de
    /// mídia e exercita put/get/delete. Não usa o banco (roda com o PG fora).
    S3Probe,
}
