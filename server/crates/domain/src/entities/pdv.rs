use crate::enums::{PdvComandaStatus, PdvComandaTipo, PdvComissaoStatus, PdvItemStatus};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::Serialize;
use sqlx::FromRow;

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct PdvMesa {
    pub id: i64,
    pub numero: String,
    pub lugares: i32,
    pub ativo: bool,
    pub version: i64,
    pub criado_em: DateTime<Utc>,
    pub atualizado_em: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct PdvGarcom {
    pub id: i64,
    pub idfuncionario: i64,
    pub percentual: Decimal,
    pub ativo: bool,
    pub criado_em: DateTime<Utc>,
    pub atualizado_em: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct PdvComanda {
    pub id: i64,
    pub tipo: PdvComandaTipo,
    pub idmesa: Option<i64>,
    pub idquarto: Option<i64>,
    pub idreserva: Option<i64>,
    pub idcliente: Option<i64>,
    pub idgarcom: Option<i64>,
    pub rotulo: Option<String>,
    pub status: PdvComandaStatus,
    pub subtotal: Decimal,
    pub desconto: Decimal,
    pub total: Decimal,
    pub idforma_pagamento: Option<i64>,
    pub idlancamento: Option<i64>,
    pub aberto_em: DateTime<Utc>,
    pub fechado_em: Option<DateTime<Utc>>,
    pub observacao: Option<String>,
    pub version: i64,
    pub criado_em: DateTime<Utc>,
    pub atualizado_em: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct PdvComandaItem {
    pub id: i64,
    pub idcomanda: i64,
    pub iditem: i64,
    pub quantidade: i32,
    pub valor_unit: Decimal,
    pub valor_total: Decimal,
    pub status: PdvItemStatus,
    pub lancado_por: Option<i64>,
    pub cancelado_por: Option<i64>,
    pub motivo_cancelamento: Option<String>,
    pub criado_em: DateTime<Utc>,
    pub atualizado_em: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct PdvComissao {
    pub id: i64,
    pub idgarcom: i64,
    pub idcomanda: i64,
    pub percentual: Decimal,
    pub base: Decimal,
    pub valor: Decimal,
    pub status: PdvComissaoStatus,
    pub idlancamento: Option<i64>,
    pub pago_em: Option<DateTime<Utc>>,
    pub criado_em: DateTime<Utc>,
}
