//! Fábrica de pool e execução de migrations.

use clarituz_domain::DomainError;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::{ConnectOptions, PgPool};
use std::str::FromStr;
use std::time::Duration;

/// Conecta com o timezone de negócio fixado na sessão — "hoje" no SQL
/// (`CURRENT_DATE`) já é o dia da pousada, não UTC.
pub async fn connect(database_url: &str, max_connections: u32) -> Result<PgPool, DomainError> {
    let mut opts = PgConnectOptions::from_str(database_url).map_err(|e| {
        tracing::error!(erro = %e, "DATABASE_URL inválida");
        DomainError::Infra
    })?;
    opts = opts
        .options([("timezone", "America/Sao_Paulo")])
        .disable_statement_logging();

    PgPoolOptions::new()
        .max_connections(max_connections)
        .acquire_timeout(Duration::from_secs(5))
        .connect_with(opts)
        .await
        .map_err(|e| {
            tracing::error!(erro = %e, "falha ao conectar no PostgreSQL");
            DomainError::Infra
        })
}

/// Aplica migrations embutidas (`server/migrations/`).
pub async fn migrate(pool: &PgPool) -> Result<(), DomainError> {
    sqlx::migrate!("../../migrations")
        .run(pool)
        .await
        .map_err(|e| {
            tracing::error!(erro = %e, "falha nas migrations");
            DomainError::Infra
        })
}

/// Mapeia `sqlx::Error` → `DomainError` sem vazar detalhes internos
/// (constraint names, SQL) para o cliente — detalhe vai para o log.
pub fn map_db_err(e: sqlx::Error) -> DomainError {
    if let sqlx::Error::Database(db) = &e {
        let code = db.code().unwrap_or_default();
        let msg = db.message();
        match code.as_ref() {
            // overbooking: exclusion constraint do período
            "23P01" => return DomainError::conflito("Acomodação já reservada para esse período."),
            // unique_violation
            "23505" => return DomainError::conflito("Registro duplicado."),
            // foreign_key_violation
            "23503" => return DomainError::validacao("Referência a registro inexistente."),
            // check_violation (ex.: saldo negativo, período invertido)
            "23514" => {
                tracing::warn!(erro = %msg, "check constraint violada");
                return DomainError::regra("Operação viola restrição de integridade.");
            }
            _ => {}
        }
    }
    match &e {
        sqlx::Error::RowNotFound => DomainError::nao_encontrado("Registro não encontrado."),
        _ => {
            tracing::error!(erro = ?e, "erro de banco");
            DomainError::Infra
        }
    }
}
