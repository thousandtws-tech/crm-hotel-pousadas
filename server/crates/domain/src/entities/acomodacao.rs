//! Acomodações: tipos, unidades anunciáveis, quartos físicos e histórico tarifário.
//!
//! Modelo do legado: `acomodacao` é a unidade reservável ("Suíte 101"),
//! `quarto` é a unidade física atribuída no check-in. Um catálogo pode ter
//! N quartos físicos (inventário por tipo).

use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::Serialize;
use sqlx::FromRow;

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct TipoAcomodacao {
    pub id: i64,
    pub nome: String,
    pub ativo: bool,
    pub version: i64,
    pub criado_em: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct Acomodacao {
    pub id: i64,
    pub idtipo_acomodacao: Option<i64>,
    pub nome: String,
    pub numero: i32,
    /// Valor da diária vigente.
    pub valor: Decimal,
    pub capacidade: i32,
    pub descricao: Option<String>,
    /// Cor do evento no calendário (`#RRGGBB`).
    pub cor: String,
    pub ativo: bool,
    pub version: i64,
    pub criado_em: DateTime<Utc>,
    pub atualizado_em: DateTime<Utc>,
}

/// Quarto físico atribuível no check-in (legado: `quarto`, nº "Q101").
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct Quarto {
    pub id: i64,
    pub idacomodacao: i64,
    pub numero: String,
    pub ativo: bool,
    pub version: i64,
    pub criado_em: DateTime<Utc>,
}

/// Histórico de alterações de tarifa — trilha de auditoria de preço.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct TarifaHistorico {
    pub id: i64,
    pub idacomodacao: i64,
    pub valor: Decimal,
    pub vigente_desde: NaiveDate,
    pub vigente_ate: Option<NaiveDate>,
    pub idfuncionario: Option<i64>,
    pub criado_em: DateTime<Utc>,
}
