use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "clarituz-api", about = "Backend do CRM da pousada")]
pub struct Cli {
    #[command(subcommand)]
    pub cmd: Option<Cmd>,
}

#[derive(Subcommand)]
pub enum Cmd {
    Serve,
    Migrate,
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
    S3Probe,
}
