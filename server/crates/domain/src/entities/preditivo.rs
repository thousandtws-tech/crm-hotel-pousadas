use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde::Serialize;
use sqlx::FromRow;

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct DiaOcupacao {
    pub data: NaiveDate,
    pub ocupados: i64,
    pub total_quartos: i64,
    pub checkins: i64,
    pub checkouts: i64,
    pub stayovers: i64,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct SemanaReceita {
    pub semana: NaiveDate,
    pub diarias: i64,
    pub receita: Decimal,
}

#[derive(Debug, Clone, Serialize)]
pub struct FluxoCaixa30d {
    pub entradas_confirmadas: Decimal,
    pub media_historica_90d: Decimal,
    pub entradas_previstas: Decimal,
    pub saidas_previstas: Decimal,
    pub saldo_previsto: Decimal,
}

#[derive(Debug, Clone, FromRow)]
pub struct FluxoCaixaRow {
    pub entradas_confirmadas: Decimal,
    pub saidas_previstas: Decimal,
    pub media_historica_90d: Decimal,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct MesHistorico {
    pub mes: NaiveDate,
    pub diarias: i64,
    pub receita: Decimal,
    pub reservas: i64,
    pub ocupacao_pct: Decimal,
    pub adr: Decimal,
}

#[derive(Debug, Clone, FromRow)]
pub struct ReservaRiscoRow {
    pub idreserva: i64,
    pub cliente: String,
    pub acomodacao: String,
    pub entrada: NaiveDate,
    pub dias_ate_checkin: i64,
    pub lead_time_dias: i64,
    pub estadias_anteriores: i64,
    pub cancelamentos_anteriores: i64,
    pub reservas_anteriores: i64,
    pub tem_pagamento_pago: bool,
    pub tem_pagamento_pendente: bool,
    pub tem_contato: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReservaRisco {
    pub idreserva: i64,
    pub cliente: String,
    pub acomodacao: String,
    pub entrada: NaiveDate,
    pub score: i32,
    pub nivel: String,
    pub sinais: Vec<String>,
    pub acao: String,
}

#[derive(Debug, Clone, FromRow)]
pub struct PerfilRow {
    pub idcliente: i64,
    pub nome: String,
    pub telefone: Option<String>,
    pub email: Option<String>,
    pub estadias: i64,
    pub ultima_estadia: Option<NaiveDate>,
    pub cancelamentos: i64,
    pub receita_estadias: Decimal,
    pub receita_consumo: Decimal,
}

#[derive(Debug, Clone, Serialize)]
pub struct PerfilHospede {
    pub idcliente: i64,
    pub nome: String,
    pub estadias: i64,
    pub ultima_estadia: Option<NaiveDate>,
    pub ltv: Decimal,
    pub classe: String,
}

#[derive(Debug, Clone, FromRow)]
pub struct PaceRow {
    pub reservas_atual: i64,
    pub receita_atual: Decimal,
    pub reservas_ano_anterior: i64,
    pub receita_ano_anterior: Decimal,
}

#[derive(Debug, Clone, Serialize)]
pub struct Pace {
    pub reservas_atual: i64,
    pub receita_atual: Decimal,
    pub reservas_ano_anterior: i64,
    pub receita_ano_anterior: Decimal,
    pub variacao_pct: Decimal,
    pub recomendacao: String,
}

#[derive(Debug, Clone, FromRow)]
pub struct EscalaDiaRow {
    pub data: NaiveDate,
    pub checkins: i64,
    pub checkouts: i64,
    pub stayovers: i64,
    pub hospedes: i64,
    pub gov_escalados: i64,
    pub rec_escalados: i64,
    pub coz_escalados: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct EscalaDia {
    pub data: NaiveDate,
    pub setor: String,
    pub demanda_min: i64,
    pub sugerido: i64,
    pub escalado: i64,
    pub deficit: i64,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct Upsell {
    pub idreserva: i64,
    pub cliente: String,
    pub acomodacao_atual: String,
    pub acomodacao_alvo: String,
    pub entrada: NaiveDate,
    pub saida: NaiveDate,
    pub diferenca_diaria: Decimal,
    pub ganho_potencial: Decimal,
}

#[derive(Debug, Clone, FromRow)]
pub struct ItemEstoqueRow {
    pub iditem: i64,
    pub nome: String,
    pub saldo: i32,
    pub consumo_30d: i64,
    pub estoque_minimo: i32,
}

#[derive(Debug, Clone, Serialize)]
pub struct ItemEstoquePrev {
    pub iditem: i64,
    pub nome: String,
    pub saldo: i32,
    pub consumo_diario_medio: Decimal,
    pub demanda_prevista_14d: Decimal,
    pub dias_restantes: Option<i64>,
    pub sugestao_compra: i64,
}

#[derive(Debug, Clone, FromRow)]
pub struct RiscoQuartoRow {
    pub idquarto: i64,
    pub numero: String,
    pub acomodacao: String,
    pub noites_90d: i64,
    pub os_90d: i64,
    pub os_abertas: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct RiscoQuarto {
    pub idquarto: i64,
    pub quarto: String,
    pub noites_90d: i64,
    pub os_90d: i64,
    pub score: i64,
    pub nivel: String,
    pub recomendacao: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct IaResumo {
    pub ocupacao_14d: Vec<DiaOcupacao>,
    pub ocupacao_media_pct: Decimal,
    pub receita_4sem: Vec<SemanaReceita>,
    pub fluxo: FluxoCaixa30d,
    pub pace: Pace,
    pub riscos_altos: i64,
    pub upsells: i64,
    pub perfis: std::collections::HashMap<String, i64>,
}
