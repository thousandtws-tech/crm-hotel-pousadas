use crate::enums::{StatusConsumo, StatusReserva};
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::Serialize;
use sqlx::FromRow;

/// Resumo de reserva para listagens e calendário.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ReservaResumo {
    pub id: i64,
    pub idacomodacao: i64,
    pub acomodacao_nome: String,
    pub acomodacao_numero: i32,
    pub acomodacao_cor: String,
    pub idcliente: i64,
    pub cliente_nome: String,
    pub quantidade_hospedes: i32,
    pub entradaprevista: NaiveDate,
    pub saidaprevista: NaiveDate,
    pub status: StatusReserva,
    pub valordiaria: Decimal,
    /// Quarto atribuído no check-in — usado pelo PDV (comanda de quarto).
    pub idquarto: Option<i64>,
    pub quarto_numero: Option<String>,
    pub valor_estadia: Option<Decimal>,
}

/// Detalhe completo da reserva (equivalente a `cDadosReserva.php`).
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ReservaDetalhe {
    pub id: i64,
    pub idacomodacao: i64,
    pub idcliente: i64,
    pub idquarto: Option<i64>,
    pub quarto_numero: Option<String>,
    pub quantidade_hospedes: i32,
    pub entradaprevista: NaiveDate,
    pub saidaprevista: NaiveDate,
    pub checkin_em: Option<DateTime<Utc>>,
    pub checkout_em: Option<DateTime<Utc>>,
    pub obs: Option<String>,
    pub status: StatusReserva,
    pub valordiaria: Decimal,
    pub criado_em: DateTime<Utc>,
    pub acomodacao_nome: String,
    pub acomodacao_numero: i32,
    pub acomodacao_valor: Decimal,
    pub cliente_nome: String,
    pub cliente_cpf: String,
    /// Contato do titular — vai como `payer` nos checkouts (antifraude).
    pub cliente_email: Option<String>,
    pub cliente_telefone: Option<String>,
    /// Prazo de pagamento da reserva online (NULL = recepção, sem hold).
    pub expira_em: Option<DateTime<Utc>>,
    /// Preenchido por segunda consulta — não vem do join principal.
    #[sqlx(skip)]
    pub consumo: Option<ConsumoResumo>,
    /// Payload da pré-ficha pública (aceite + assinatura desenhada).
    #[sqlx(default)]
    pub fnrh_hospede: Option<serde_json::Value>,
}

/// Pendências do fechamento do dia — reservas a decidir e contas abertas.
#[derive(Debug, Clone, Serialize)]
pub struct PendenciasFechamento {
    /// Reservas confirmadas que não fizeram check-in até a data prevista.
    pub no_shows: Vec<PendenciaReserva>,
    /// Estadias em curso com saída prevista vencida ou vencendo hoje.
    pub checkouts_pendentes: Vec<PendenciaReserva>,
    pub contas_abertas: i64,
    pub contas_total: Decimal,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct PendenciaReserva {
    pub id: i64,
    pub cliente_nome: String,
    pub acomodacao_nome: String,
    pub entradaprevista: NaiveDate,
    pub saidaprevista: NaiveDate,
    pub dias_atraso: i32,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ConsumoResumo {
    pub id: i64,
    pub status: StatusConsumo,
    pub valor_estadia: Decimal,
    pub valor_itens: Decimal,
    pub valor_adicional: Decimal,
    pub total_desconto: Decimal,
    pub valor_final: Option<Decimal>,
    pub idforma_pagamento: Option<i64>,
    pub forma_pagamento: Option<String>,
    pub comprovante: Option<String>,
    pub fechado_em: Option<DateTime<Utc>>,
}

/// Acomodação livre no período (equivalente a `api/disponibilidade.php`).
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct AcomodacaoDisponivel {
    pub id: i64,
    pub nome: String,
    pub numero: i32,
    pub valor: Decimal,
    pub capacidade: i32,
}
