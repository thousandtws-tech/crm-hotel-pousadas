use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::Serialize;
use sqlx::FromRow;

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct Estabelecimento {
    pub id: i64,
    pub cnpj: Option<String>,
    pub razao_social: Option<String>,
    pub site: Option<String>,
    pub email: Option<String>,
    pub telefone: Option<String>,
    pub celular: Option<String>,
    pub impressora_ip: Option<String>,
    pub impressora_porta: i32,
    pub impressora_ativa: bool,
    pub taxa_early: Decimal,
    pub taxa_late: Decimal,
    pub wifi_nome: Option<String>,
    pub wifi_senha: Option<String>,
    pub horario_checkin: Option<String>,
    pub horario_checkout: Option<String>,
    pub horario_cafe: Option<String>,
    pub info_servicos: Option<String>,
    pub cadastur: Option<String>,
    pub politica_cancelamento: serde_json::Value,
    pub retencao_dados_anos: i32,
    pub dpo_email: Option<String>,
    pub fnrh_assinatura: bool,
    pub pin_fechamento: Option<String>,
    pub version: i64,
    pub criado_em: DateTime<Utc>,
    pub atualizado_em: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct EnderecoEstabelecimento {
    pub id: i64,
    pub idestabelecimento: i64,
    pub logradouro: Option<String>,
    pub numero: Option<String>,
    pub complemento: Option<String>,
    pub bairro: Option<String>,
    pub cidade: Option<String>,
    pub cep: Option<String>,
    pub version: i64,
    pub criado_em: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct LogoEstabelecimento {
    pub id: i64,
    pub idestabelecimento: Option<i64>,
    pub nome: String,
    pub caminho: String,
    pub criado_em: DateTime<Utc>,
}
