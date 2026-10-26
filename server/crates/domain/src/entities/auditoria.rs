//! Trilha de auditoria — toda mutação relevante grava um `RegistroLog`
//! na mesma transação da operação (nunca best-effort fora dela).

use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::Value as JsonValue;
use sqlx::FromRow;

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct RegistroLog {
    pub id: i64,
    pub idfuncionario: Option<i64>,
    /// Nome do funcionário (LEFT JOIN) — "Realizado por" dos modais do legado.
    pub funcionario_nome: Option<String>,
    /// 'cadastro' | 'edição' | 'checkin' | 'checkout' | 'cancelar' | ...
    pub acao: String,
    /// Descrição legível (legado usava HTML em `obs`; aqui texto puro).
    pub obs: Option<String>,
    pub tabela: Option<String>,
    pub idtabela: Option<i64>,
    /// Payload estruturado do evento.
    pub dados: Option<JsonValue>,
    pub criado_em: DateTime<Utc>,
}

/// Registro a ser inserido (contexto do ator resolvido pela aplicação).
#[derive(Debug, Clone)]
pub struct NovoLog {
    pub idfuncionario: Option<i64>,
    pub acao: String,
    pub obs: String,
    pub tabela: &'static str,
    pub idtabela: i64,
    pub dados: Option<JsonValue>,
}
