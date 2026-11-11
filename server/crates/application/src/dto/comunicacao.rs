use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct RespostaAvaliacaoInput {
    pub nota_geral: i16,
    pub nota_limpeza: Option<i16>,
    pub nota_atendimento: Option<i16>,
    pub nota_custo: Option<i16>,
    pub nota_localizacao: Option<i16>,
    pub nps: Option<i16>,
    pub comentario: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ResponderAvaliacaoInput {
    pub resposta: String,
}

#[derive(Debug, Deserialize)]
pub struct MatrizRegraInput {
    pub evento: String,
    pub canal: clarituz_domain::enums::CanalEnvio,
    pub papel: i16,
    pub ativo: bool,
}

#[derive(Debug, Deserialize)]
pub struct PushSubscriptionInput {
    pub endpoint: String,
    pub p256dh: String,
    pub auth: String,
    pub user_agent: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct NivelFidelidadeInput {
    pub nome: String,
    pub min_diarias: i32,
    pub desconto_pct: rust_decimal::Decimal,
    pub beneficios: Option<String>,
    pub ordem: i16,
    pub ativo: bool,
}

#[derive(Debug, Deserialize)]
pub struct CobrancaInput {
    /// Link de pagamento gerado pela recepção (Pix manual ou gateway).
    pub link_pagamento: String,
}
