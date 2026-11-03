//! Entidades do PDV & Comandas — vendas de salão, quarto e balcão.
//!
//! A comanda acumula itens vendidos; cada item dá baixa no estoque no
//! lançamento e devolve no cancelamento. No fechamento, o espelho
//! financeiro (lançamento + baixa) e a comissão do garçom são gerados
//! na mesma transação.

use crate::enums::{PdvComandaStatus, PdvComandaTipo, PdvComissaoStatus, PdvItemStatus};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::Serialize;
use sqlx::FromRow;

/// Mesa do salão — comanda do tipo `mesa` exige uma mesa ativa.
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

/// Garçom cadastrado — percentual de comissão por funcionário.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct PdvGarcom {
    pub id: i64,
    pub idfuncionario: i64,
    /// % sobre o total da comanda fechada.
    pub percentual: Decimal,
    pub ativo: bool,
    pub criado_em: DateTime<Utc>,
    pub atualizado_em: DateTime<Utc>,
}

/// Comanda aberta — uma por mesa (índice parcial no banco).
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct PdvComanda {
    pub id: i64,
    pub tipo: PdvComandaTipo,
    pub idmesa: Option<i64>,
    pub idquarto: Option<i64>,
    /// Reserva em estadia — só no tipo `quarto` (faturar no checkout).
    pub idreserva: Option<i64>,
    pub idcliente: Option<i64>,
    pub idgarcom: Option<i64>,
    /// Rótulo livre — obrigatório no tipo `balcao`.
    pub rotulo: Option<String>,
    pub status: PdvComandaStatus,
    pub subtotal: Decimal,
    pub desconto: Decimal,
    pub total: Decimal,
    pub idforma_pagamento: Option<i64>,
    /// Lançamento financeiro gerado no fechamento.
    pub idlancamento: Option<i64>,
    pub aberto_em: DateTime<Utc>,
    pub fechado_em: Option<DateTime<Utc>>,
    pub observacao: Option<String>,
    pub version: i64,
    pub criado_em: DateTime<Utc>,
    pub atualizado_em: DateTime<Utc>,
}

/// Item lançado na comanda — baixa no estoque no registro.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct PdvComandaItem {
    pub id: i64,
    pub idcomanda: i64,
    pub iditem: i64,
    pub quantidade: i32,
    /// Preço real do estoque no momento do lançamento.
    pub valor_unit: Decimal,
    pub valor_total: Decimal,
    pub status: PdvItemStatus,
    pub lancado_por: Option<i64>,
    pub cancelado_por: Option<i64>,
    pub motivo_cancelamento: Option<String>,
    pub criado_em: DateTime<Utc>,
    pub atualizado_em: DateTime<Utc>,
}

/// Comissão provisionada no fechamento — uma por comanda com garçom.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct PdvComissao {
    pub id: i64,
    pub idgarcom: i64,
    pub idcomanda: i64,
    /// % vigente do garçom no fechamento (snapshot).
    pub percentual: Decimal,
    /// Total da comanda que serviu de base.
    pub base: Decimal,
    pub valor: Decimal,
    pub status: PdvComissaoStatus,
    /// Lançamento a pagar gerado na quitação.
    pub idlancamento: Option<i64>,
    pub pago_em: Option<DateTime<Utc>>,
    pub criado_em: DateTime<Utc>,
}
