//! Entidades do controle de caixa (gaveta física por turno de operador).
//!
//! `caixa_turno` amarra uma conta financeira do tipo `caixa` a um operador
//! por um intervalo [aberto_em, fechado_em]. O esperado no fechamento é
//! derivado do ledger — o sistema nunca confia em valor digitado.

use crate::enums::{StatusTurno, TipoMovimentoCaixa};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::Serialize;
use sqlx::FromRow;

/// Turno de caixa — um aberto por gaveta (`caixa_turno_unico_aberto`).
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct CaixaTurno {
    pub id: i64,
    pub idconta_financeira: i64,
    /// Operador dono do turno (quem abriu).
    pub idoperador: i64,
    /// Fundo de troco no momento da abertura.
    pub saldo_inicial: Decimal,
    pub aberto_em: DateTime<Utc>,
    pub fechado_em: Option<DateTime<Utc>>,
    /// Dinheiro contado fisicamente no fechamento.
    pub valor_contado: Option<Decimal>,
    /// Esperado calculado pelo sistema no fechamento.
    pub valor_esperado: Option<Decimal>,
    /// contado − esperado: negativo = quebra (falta), positivo = sobra.
    pub quebra: Option<Decimal>,
    pub status: StatusTurno,
    pub observacao: Option<String>,
    /// Quem conferiu/fechou (pode ser outro operador que o dono).
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

/// Movimento avulso de dinheiro vivo — sangria (sai) ou suprimento (entra).
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
