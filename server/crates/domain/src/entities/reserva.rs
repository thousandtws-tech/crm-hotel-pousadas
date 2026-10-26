//! Agregado Reserva — coração do sistema: ciclo de vida, conta de consumo,
//! itens consumidos, adicionais e reembolsos.

use crate::enums::{StatusConsumo, StatusReserva};
use crate::error::DomainError;
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::Serialize;
use sqlx::FromRow;

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct Reserva {
    pub id: i64,
    pub idacomodacao: i64,
    pub idcliente: i64,
    /// Quarto físico atribuído no check-in (NULL até lá).
    pub idquarto: Option<i64>,
    pub quantidade_hospedes: i32,
    pub entradaprevista: NaiveDate,
    pub saidaprevista: NaiveDate,
    pub checkin_em: Option<DateTime<Utc>>,
    pub checkout_em: Option<DateTime<Utc>>,
    pub obs: Option<String>,
    pub status: StatusReserva,
    /// Diária contratada no momento da reserva (congelada — imune a
    /// reajustes posteriores da tarifa da acomodação).
    pub valordiaria: Decimal,
    pub criado_em: DateTime<Utc>,
    pub atualizado_em: DateTime<Utc>,
}

impl Reserva {
    /// Máquina de estados explícita — fail-fast em transição inválida.
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

/// Conta da estadia — fechada no check-out.
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
    /// Nome do arquivo de comprovante gerado.
    pub comprovante: Option<String>,
    pub status: StatusConsumo,
    pub fechado_em: Option<DateTime<Utc>>,
    pub criado_em: DateTime<Utc>,
    pub atualizado_em: DateTime<Utc>,
}

impl Consumo {
    /// Totais correntes da conta aberta.
    pub fn bruto(&self) -> Decimal {
        self.valor_estadia + self.valor_itens + self.valor_adicional
    }
}

/// Lançamento avulso no fechamento (multa, dano, serviço extra).
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct AdicionalConsumo {
    pub id: i64,
    pub idconsumo: i64,
    pub motivo: String,
    pub valor: Decimal,
    pub criado_em: DateTime<Utc>,
}

/// Item de frigobar vendido durante a estadia.
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

/// Reembolso registrado quando reserva paga/concluída é cancelada.
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

/// Acompanhante vinculado à reserva (cônjuge, filhos menores etc.) — dados
/// próprios sem exigir cadastro como cliente titular.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct Acompanhante {
    pub id: i64,
    pub idreserva: i64,
    pub nome: String,
    /// `None` quando não informada — FNRH aceita acompanhante sem doc/nascimento.
    pub data_nascimento: Option<NaiveDate>,
    pub parentesco: Option<String>,
    pub doc_tipo: Option<String>,
    pub doc_numero: Option<String>,
    pub criado_em: DateTime<Utc>,
}

/// FNRH emitida — Ficha Nacional de Registro de Hóspedes (arquivo digital).
/// `dados` é o snapshot JSON imutável gerado na emissão (cliente + reserva +
/// acompanhantes), preservado para auditoria mesmo após edições posteriores.
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
