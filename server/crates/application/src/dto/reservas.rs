use super::de::{de_decimal, de_decimal_opt, de_i64_opt};
use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use chrono_tz::America::Sao_Paulo;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct AcompanhanteInput {
    pub nome: String,
    pub data_nascimento: Option<NaiveDate>,
    pub parentesco: Option<String>,
    pub doc_tipo: Option<String>,
    pub doc_numero: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct FnrhEmitRequest {
    pub motivo_viagem: Option<String>,
    pub placa_veiculo: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct NoShowRequest {
    pub pin: String,
}
#[derive(Debug, Deserialize)]
pub struct ReservaInput {
    pub idacomodacao: i64,
    pub idcliente: i64,
    pub quantidade_hospedes: i32,
    pub entradaprevista: NaiveDate,
    pub saidaprevista: NaiveDate,
    pub obs: Option<String>,
    #[serde(default, deserialize_with = "de_decimal_opt")]
    pub valordiaria: Option<Decimal>,
    pub early_checkin: Option<bool>,
    pub late_checkout: Option<bool>,
    pub idoperadora: Option<i64>,
    pub idcontrato: Option<i64>,
}

/// Remanejamento pelo mapa de ocupação — arrastar a reserva muda a
/// acomodação e/ou o período; a exclusion constraint protege o drop.
#[derive(Debug, Deserialize)]
pub struct RemanejarInput {
    /// Nova acomodação; `None` mantém a atual (drag só horizontal).
    pub idacomodacao: Option<i64>,
    pub entradaprevista: NaiveDate,
    pub saidaprevista: NaiveDate,
}

#[derive(Debug, Deserialize)]
pub struct ReservaPublicaInput {
    pub slug: Option<String>,
    pub idacomodacao: Option<i64>,
    pub check_in: NaiveDate,
    pub check_out: NaiveDate,
    pub hospedes: i32,
    pub nome: String,
    pub email: String,
    pub telefone: String,
    pub cpf: Option<String>,
    pub observacoes: Option<String>,
    pub early_checkin: Option<bool>,
    pub late_checkout: Option<bool>,
    #[serde(default)]
    pub aceito_termos: bool,
    #[serde(default)]
    pub aceito_marketing: bool,
    /// Consentimento transacional de WhatsApp (status da reserva) —
    /// independente do marketing; clientes antigos/padrao → false.
    #[serde(default)]
    pub aceito_whatsapp: bool,
    /// Landsnummer (DDI) från väljaren på webbplatsen — t.ex. "55".
    /// Tas bort från telefonnumret om det redan ingår.
    pub telefone_ddi: Option<String>,
    pub codigo_corporativo: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ReservaPublicaOutput {
    pub ok: bool,
    pub status: &'static str,
    pub idreserva: Option<i64>,
    pub idcliente: i64,
    pub token_publico: Option<uuid::Uuid>,
    pub mensagem: String,
}
#[derive(Debug, Deserialize, Default)]
pub struct CheckinRequest {
    pub data: Option<NaiveDate>,
    pub hora: Option<NaiveTime>,
}

impl CheckinRequest {
    pub fn instante(&self) -> DateTime<Utc> {
        let hoje = clarituz_shared::time::hoje();
        let data = self.data.unwrap_or(hoje);
        let hora = self.hora.unwrap_or_else(|| Utc::now().time());
        match data.and_time(hora).and_local_timezone(Sao_Paulo).single() {
            Some(dt) => dt.with_timezone(&Utc),
            None => Utc::now(),
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct AdicionalInput {
    pub motivo: String,
    #[serde(deserialize_with = "de_decimal")]
    pub valor: Decimal,
}

#[derive(Debug, Deserialize)]
pub struct CheckoutRequest {
    pub idforma_pagamento: i64,
    #[serde(default, deserialize_with = "de_decimal_opt")]
    pub total_desconto: Option<Decimal>,
    #[serde(default)]
    pub adicionais: Vec<AdicionalInput>,
}

#[derive(Debug, Deserialize)]
pub struct CancelarReservaRequest {
    pub motivo: Option<String>,
    pub login_admin: Option<String>,
    pub senha_admin: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ItemConsumidoRequest {
    pub iditem_frigobar: i64,
    pub quantidade: i32,
}

#[derive(Debug, Deserialize)]
pub struct DisponibilidadeQuery {
    pub inicio: NaiveDate,
    pub fim: NaiveDate,
    pub idacomodacao: Option<i64>,
    pub excluir_reserva: Option<i64>,
    pub hospedes: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct TarifaOcupacaoInput {
    pub hospedes: i32,
    #[serde(deserialize_with = "de_decimal")]
    pub valor: Decimal,
}

#[derive(Debug, Deserialize)]
pub struct GrupoInput {
    pub nome: String,
    pub contato: Option<String>,
    pub obs: Option<String>,
    pub inicio: NaiveDate,
    pub fim: NaiveDate,
    pub unidades: Vec<i64>,
    pub bloquear: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct ReservaFiltroQuery {
    pub inicio: Option<NaiveDate>,
    pub fim: Option<NaiveDate>,
    pub status: Option<String>,
    #[serde(default, deserialize_with = "de_i64_opt")]
    pub idacomodacao: Option<i64>,
    #[serde(default, deserialize_with = "de_i64_opt")]
    pub idcliente: Option<i64>,
    pub busca: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct DisponibilidadeResponse {
    pub disponivel: bool,
    pub quantidade: usize,
    pub diarias: u32,
    pub inicio: NaiveDate,
    pub fim: NaiveDate,
    pub acomodacoes: Vec<clarituz_domain::queries::AcomodacaoDisponivel>,
}

#[derive(Debug, Serialize)]
pub struct CancelamentoResponse {
    pub reserva: clarituz_domain::entities::Reserva,
    pub reembolso: Option<clarituz_domain::entities::Reembolso>,
}

pub const TOLERANCIAS_VALIDAS: [i32; 6] = [0, 1, 2, 3, 7, 14];

#[derive(Debug, Deserialize)]
pub struct BuscaHospedesInput {
    pub adults: i32,
    #[serde(default)]
    pub children: i32,
    #[serde(default)]
    pub infants: i32,
    #[serde(default)]
    pub pets: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StayPresetInput {
    Weekend,
    Week,
    Month,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "mode", rename_all = "lowercase")]
pub enum BuscaDateInput {
    Dates {
        #[serde(rename = "checkIn")]
        check_in: NaiveDate,
        #[serde(rename = "checkOut")]
        check_out: NaiveDate,
        #[serde(rename = "toleranceDays")]
        tolerance_days: i32,
    },
    Flexible {
        #[serde(rename = "stayPreset")]
        stay_preset: StayPresetInput,
        months: Vec<String>,
    },
}

#[derive(Debug, Deserialize)]
pub struct BuscaPublicaInput {
    pub date: BuscaDateInput,
    pub guests: BuscaHospedesInput,
    #[serde(default)]
    pub acomodacao_slug: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct BuscaAcomodacaoOut {
    pub id: i64,
    pub slug: String,
    pub nome: String,
    pub numero: i32,
    pub capacidade: i32,
    pub valor: Decimal,
}

#[derive(Debug, Serialize)]
pub struct BuscaAlternativaOut {
    pub inicio: NaiveDate,
    pub fim: NaiveDate,
    pub noites: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deslocamento: Option<i32>,
    pub acomodacoes: Vec<BuscaAcomodacaoOut>,
}

#[derive(Debug, Serialize)]
pub struct BuscaPublicaResponse {
    pub alternativas: Vec<BuscaAlternativaOut>,
    pub periodos: usize,
    pub com_disponibilidade: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aviso: Option<String>,
}
