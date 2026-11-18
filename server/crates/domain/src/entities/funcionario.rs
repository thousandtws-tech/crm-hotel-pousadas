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
    pub nivel: i16,
    /// Cargo (título) vinculado — `nivel` é o acesso derivado dele.
    pub cargo_id: i64,

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

/// Cargo — título do funcionário vinculado a um nível de acesso.
/// `sistema` marca os cargos-base (Administrador/Gerente/Recepção):
/// não removíveis e com `nivel` travado.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct Cargo {
    pub id: i64,
    pub nome: String,
    pub descricao: Option<String>,
    pub nivel: i16,
    pub ativo: bool,
    pub sistema: bool,
    #[sqlx(default)]
    pub total_funcionarios: i64,
    pub criado_em: DateTime<Utc>,
    pub atualizado_em: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct LogAcesso {
    pub id: i64,
    pub idfuncionario: i64,
    pub ip: Option<String>,
    pub user_agent: Option<String>,
    pub criado_em: DateTime<Utc>,
}

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
