//! Funcionário — identidade operacional e autenticação.

use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct Funcionario {
    pub id: i64,
    pub nome: String,
    pub login: String,
    #[serde(skip_serializing)]
    pub senha_hash: String,
    pub cpf: Option<String>,
    pub data_nascimento: Option<NaiveDate>,
    /// 1 = administrador, 2 = gerente, 3+ = operacional.
    pub nivel: i16,
    /// Permissão granular de operações financeiras (reembolso, conciliação).
    /// Admin possui implicitamente — ver `Ator::exigir_financeiro`.
    pub financeiro: bool,
    pub ativo: bool,
    pub version: i64,
    pub criado_em: DateTime<Utc>,
    pub atualizado_em: DateTime<Utc>,
}

impl Funcionario {
    pub fn is_admin(&self) -> bool {
        self.nivel == 1
    }
}

/// Registro de acesso (legado: `logacesso`).
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct LogAcesso {
    pub id: i64,
    pub idfuncionario: i64,
    pub ip: Option<String>,
    pub user_agent: Option<String>,
    pub criado_em: DateTime<Utc>,
}

/// Refresh token persistido apenas como hash SHA-256 — o valor claro
/// nunca toca o banco (rotação + revogação por linha).
#[derive(Debug, Clone, FromRow)]
pub struct SessaoRefresh {
    pub id: Uuid,
    pub idfuncionario: i64,
    pub token_hash: String,
    pub expira_em: DateTime<Utc>,
    pub revogado_em: Option<DateTime<Utc>>,
    pub ip: Option<String>,
    pub user_agent: Option<String>,
    pub criado_em: DateTime<Utc>,
}
