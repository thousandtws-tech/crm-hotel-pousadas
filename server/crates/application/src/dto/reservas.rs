use super::de::{de_decimal, de_decimal_opt, de_i64_opt};
use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use chrono_tz::America::Sao_Paulo;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

/// Acompanhante da reserva (cônjuge, filhos menores etc.).
#[derive(Debug, Deserialize)]
pub struct AcompanhanteInput {
    pub nome: String,
    pub data_nascimento: Option<NaiveDate>,
    pub parentesco: Option<String>,
    pub doc_tipo: Option<String>,
    pub doc_numero: Option<String>,
}

/// Emissão da FNRH — dados que variam por estadia (motivo, veículo).
/// O restante da ficha é montado no servidor a partir do cadastro/reserva.
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
    /// Opcional: quando ausente usa a tarifa vigente da acomodação.
    #[serde(default, deserialize_with = "de_decimal_opt")]
    pub valordiaria: Option<Decimal>,
    /// Entrada antecipada — sujeita à disponibilidade, taxa somada ao total.
    pub early_checkin: Option<bool>,
    /// Saída estendida — idem.
    pub late_checkout: Option<bool>,
    /// Operadora B2B de origem — a recepção pode marcar a consolidação.
    pub idoperadora: Option<i64>,
    /// Contrato corporativo (desconto negociado) vinculado pela recepção.
    pub idcontrato: Option<i64>,
}

/// Reserva online vinda do site público — sem autenticação; o serviço
/// registra o cliente (find-or-create por e-mail/CPF) e cria reserva
/// pendente, ou registra consulta quando o período está ocupado.
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
    /// Early check-in / late checkout — mesma regra de cobrança da operação.
    pub early_checkin: Option<bool>,
    pub late_checkout: Option<bool>,
    /// CDC + LGPD — hóspede marcou que leu política de cancelamento e
    /// privacidade. Obrigatório: o aceite (data+IP) fica na reserva.
    #[serde(default)]
    pub aceito_termos: bool,
    /// Consentimento de marketing (opcional, checkbox separada — LGPD art. 8º).
    #[serde(default)]
    pub aceito_marketing: bool,
    /// Código de contrato corporativo — desconto negociado no motor.
    pub codigo_corporativo: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ReservaPublicaOutput {
    pub ok: bool,
    /// `"reserva_criada"` ou `"consulta_registrada"` (período ocupado).
    pub status: &'static str,
    pub idreserva: Option<i64>,
    pub idcliente: i64,
    /// Token público opaco — o site usa para criar o checkout e consultar
    /// o status sem expor o id sequencial (anti-enumeração).
    pub token_publico: Option<uuid::Uuid>,
    pub mensagem: String,
}
#[derive(Debug, Deserialize, Default)]
pub struct CheckinRequest {
    /// Data do check-in — default: hoje (fuso da pousada).
    pub data: Option<NaiveDate>,
    /// Hora do check-in — default: agora.
    pub hora: Option<NaiveTime>,
}

impl CheckinRequest {
    /// Combina data/hora no fuso do negócio e converte para UTC.
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
    /// Credenciais de administrador — exigidas para cancelar reserva
    /// já em estadia (`iniciada`) por um operador não-admin.
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
    /// Reprecifica `valor` pela faixa de ocupação do tipo quando presente.
    pub hospedes: Option<i32>,
}

/// Faixa de tarifa por ocupação (1..20 hóspedes → diária), por tipo.
#[derive(Debug, Deserialize)]
pub struct TarifaOcupacaoInput {
    pub hospedes: i32,
    #[serde(deserialize_with = "de_decimal")]
    pub valor: Decimal,
}

/// Grupo/evento — rooming list de unidades com bloqueio em massa opcional.
#[derive(Debug, Deserialize)]
pub struct GrupoInput {
    pub nome: String,
    pub contato: Option<String>,
    pub obs: Option<String>,
    pub inicio: NaiveDate,
    pub fim: NaiveDate,
    /// ids das acomodações alocadas ao grupo.
    pub unidades: Vec<i64>,
    /// `true` (default) tira as unidades de venda no período via bloqueio.
    pub bloquear: Option<bool>,
}

/// Filtros de listagem de reservas — **achatado** (`#[serde(flatten)]`)
/// dentro da query do handler, portanto inteiros chegam como string.
#[derive(Debug, Deserialize)]
pub struct ReservaFiltroQuery {
    pub inicio: Option<NaiveDate>,
    pub fim: Option<NaiveDate>,
    pub status: Option<String>,
    #[serde(default, deserialize_with = "de_i64_opt")]
    pub idacomodacao: Option<i64>,
    #[serde(default, deserialize_with = "de_i64_opt")]
    pub idcliente: Option<i64>,
    /// Busca livre (cliente, acomodação ou nº da reserva).
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
