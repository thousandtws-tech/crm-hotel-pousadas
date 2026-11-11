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
    /// Pavimento — agrupa o mapa de ocupação (0 = térreo/recepção).
    pub andar: i32,
    pub valor: Decimal,
    pub capacidade: i32,
    pub descricao: Option<String>,
    pub cor: String,
    pub ativo: bool,
    pub version: i64,
    pub criado_em: DateTime<Utc>,
    pub atualizado_em: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct Quarto {
    pub id: i64,
    pub idacomodacao: i64,
    pub numero: String,
    pub ativo: bool,
    pub version: i64,
    pub criado_em: DateTime<Utc>,
}

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

/// Diária por faixa de ocupação de um tipo de acomodação — substitui o
/// `acomodacao.valor` como default quando o tipo possui faixas definidas.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct TarifaOcupacao {
    pub id: i64,
    pub idtipo_acomodacao: i64,
    pub hospedes: i32,
    pub valor: Decimal,
    pub criado_em: DateTime<Utc>,
    pub atualizado_em: DateTime<Utc>,
}
