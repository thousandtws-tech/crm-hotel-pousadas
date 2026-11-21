use crate::enums::{StatusConsumo, StatusReserva};
use crate::error::DomainError;
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::Serialize;
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct Reserva {
    pub id: i64,
    pub idacomodacao: i64,
    pub idcliente: i64,
    pub idquarto: Option<i64>,
    pub quantidade_hospedes: i32,
    pub entradaprevista: NaiveDate,
    pub saidaprevista: NaiveDate,
    pub checkin_em: Option<DateTime<Utc>>,
    pub checkout_em: Option<DateTime<Utc>>,
    pub obs: Option<String>,
    pub status: StatusReserva,
    pub valordiaria: Decimal,
    pub expira_em: Option<DateTime<Utc>>,
    pub token_publico: Uuid,
    pub early_checkin: bool,
    pub late_checkout: bool,
    pub idoperadora: Option<i64>,
    pub idcontrato: Option<i64>,
    pub criado_em: DateTime<Utc>,
    pub atualizado_em: DateTime<Utc>,
}

impl Reserva {
    pub fn checkin(&mut self, idquarto: Option<i64>, em: DateTime<Utc>) -> Result<(), DomainError> {
        match self.status {
            StatusReserva::Cancelada => {
                return Err(DomainError::conflito(
                    "Reserva cancelada. Não é possível realizar check-in.",
                ))
            }
            StatusReserva::Iniciada => {
                return Err(DomainError::conflito("Check-in já foi realizado."))
            }
            StatusReserva::Finalizada => {
                return Err(DomainError::conflito("Reserva já finalizada."))
            }
            StatusReserva::Pendente => {}
        }
        self.status = StatusReserva::Iniciada;
        self.checkin_em = Some(em);
        self.idquarto = idquarto;
        Ok(())
    }

    pub fn checkout(&mut self, em: DateTime<Utc>) -> Result<(), DomainError> {
        match self.status {
            StatusReserva::Cancelada => {
                return Err(DomainError::conflito(
                    "Reserva cancelada. Não é possível realizar check-out.",
                ))
            }
            StatusReserva::Finalizada => {
                return Err(DomainError::conflito("Check-out já realizado."))
            }
            StatusReserva::Pendente => {
                return Err(DomainError::regra(
                    "É necessário realizar o check-in antes do check-out.",
                ))
            }
            StatusReserva::Iniciada => {}
        }
        self.status = StatusReserva::Finalizada;
        self.checkout_em = Some(em);
        Ok(())
    }

    pub fn cancelar(&mut self) -> Result<(), DomainError> {
        match self.status {
            StatusReserva::Cancelada => {
                return Err(DomainError::conflito("Reserva já está cancelada."))
            }
            StatusReserva::Finalizada => {
                return Err(DomainError::conflito(
                    "Reserva já finalizada. Para desfaturar, use reembolso.",
                ))
            }
            StatusReserva::Pendente | StatusReserva::Iniciada => {}
        }
        self.status = StatusReserva::Cancelada;
        Ok(())
    }
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct Consumo {
    pub id: i64,
    pub idreserva: i64,
    pub valor_estadia: Decimal,
    pub valor_itens: Decimal,
    pub valor_adicional: Decimal,
    pub total_desconto: Decimal,
    pub valor_final: Option<Decimal>,
    pub idforma_pagamento: Option<i64>,
    pub comprovante: Option<String>,
    pub status: StatusConsumo,
    pub fechado_em: Option<DateTime<Utc>>,
    pub criado_em: DateTime<Utc>,
    pub atualizado_em: DateTime<Utc>,
}

impl Consumo {
    pub fn bruto(&self) -> Decimal {
        self.valor_estadia + self.valor_itens + self.valor_adicional
    }
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct AdicionalConsumo {
    pub id: i64,
    pub idconsumo: i64,
    pub motivo: String,
    pub valor: Decimal,
    pub criado_em: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct ItemConsumido {
    pub id: i64,
    pub idconsumo: i64,
    pub iditem: i64,
    pub nome: String,
    pub quantidade: i32,
    pub valor_total: Decimal,
    pub criado_em: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct Reembolso {
    pub id: i64,
    pub idconsumo: i64,
    pub idreserva: i64,
    pub idfuncionario: Option<i64>,
    pub valor: Decimal,
    pub motivo: Option<String>,
    pub criado_em: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct Acompanhante {
    pub id: i64,
    pub idreserva: i64,
    pub nome: String,
    pub data_nascimento: Option<NaiveDate>,
    pub parentesco: Option<String>,
    pub doc_tipo: Option<String>,
    pub doc_numero: Option<String>,
    pub criado_em: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct Fnrh {
    pub id: i64,
    pub idreserva: i64,
    pub idcliente: i64,
    pub motivo_viagem: Option<String>,
    pub placa_veiculo: Option<String>,
    pub dados: serde_json::Value,
    pub emitida_por: Option<i64>,
    pub emitida_em: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct Bloqueio {
    pub id: i64,
    pub idacomodacao: i64,
    pub inicio: NaiveDate,
    pub fim: NaiveDate,
    pub motivo: String,
    pub criado_por: Option<i64>,
    pub criado_em: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct Grupo {
    pub id: i64,
    pub nome: String,
    pub contato: Option<String>,
    /// Operadora B2B de origem (excursão de agência) — None em grupo próprio.
    pub idoperadora: Option<i64>,
    /// Nome da operadora — via LEFT JOIN na listagem; None nas demais consultas.
    pub operadora_nome: Option<String>,
    pub obs: Option<String>,
    pub inicio: NaiveDate,
    pub fim: NaiveDate,
    pub criado_por: Option<i64>,
    pub criado_em: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct GrupoUnidade {
    pub id: i64,
    pub idgrupo: i64,
    pub idacomodacao: i64,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct GrupoUnidadeView {
    pub id: i64,
    pub idacomodacao: i64,
    pub acomodacao_nome: String,
    pub acomodacao_numero: i32,
    pub idreserva: Option<i64>,
    pub hospede: Option<String>,
    pub reserva_status: Option<String>,
}
