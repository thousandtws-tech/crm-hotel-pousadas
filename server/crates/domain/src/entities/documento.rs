//! Documento de identidade do hóspede — RG, CPF, CNH, passaporte, RNE.
//! Um cliente pode ter vários documentos; o scan fica no storage
//! (`documentos/{id}.{ext}`) e a coluna `scan` guarda só o caminho.

use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use sqlx::FromRow;

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct ClienteDocumento {
    pub id: i64,
    pub idcliente: i64,
    /// `rg`, `cpf`, `cnh`, `passaporte`, `rne` ou `outro`.
    pub tipo: String,
    pub numero: String,
    pub orgao_emissor: Option<String>,
    pub uf_emissor: Option<String>,
    pub pais_emissor: Option<String>,
    pub validade: Option<NaiveDate>,
    /// Derivada de `scan IS NOT NULL` — expõe só a existência, nunca o caminho.
    pub tem_scan: bool,
    /// Concorrência otimista — incrementada pelo trigger `bump_version`.
    pub version: i64,
    pub criado_em: DateTime<Utc>,
    pub atualizado_em: DateTime<Utc>,
}
