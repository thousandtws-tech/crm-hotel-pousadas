use crate::enums::{StatusTurno, TipoMovimentoCaixa};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::Serialize;
use sqlx::FromRow;

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct CaixaTurno {
    pub id: i64,
    pub idconta_financeira: i64,
    pub idoperador: i64,
    pub saldo_inicial: Decimal,
    pub aberto_em: DateTime<Utc>,
    pub fechado_em: Option<DateTime<Utc>>,
    pub valor_contado: Option<Decimal>,
    pub valor_esperado: Option<Decimal>,
    pub quebra: Option<Decimal>,
    pub status: StatusTurno,
    pub observacao: Option<String>,
    pub fechado_por: Option<i64>,
    pub version: i64,
    pub criado_em: DateTime<Utc>,
    pub atualizado_em: DateTime<Utc>,
}

impl CaixaTurno {
    pub fn aberto(&self) -> bool {
        self.status == StatusTurno::Aberto
    }
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct CaixaMovimento {
    pub id: i64,
    pub idturno: i64,
    pub tipo: TipoMovimentoCaixa,
    pub valor: Decimal,
    pub motivo: String,
    pub idfuncionario: i64,
    pub criado_em: DateTime<Utc>,
}
