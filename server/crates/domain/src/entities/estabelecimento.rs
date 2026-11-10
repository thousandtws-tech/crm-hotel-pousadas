//! Estabelecimento — dados da própria pousada (singleton operacional).

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
    /// Impressora térmica ESC/POS de rede (RAW TCP, geralmente porta 9100).
    pub impressora_ip: Option<String>,
    pub impressora_porta: i32,
    pub impressora_ativa: bool,
    /// Taxa de entrada antecipada — somada ao total da estadia (base do sinal).
    pub taxa_early: Decimal,
    /// Taxa de saída estendida — idem.
    pub taxa_late: Decimal,
    /// Dados factuais exibidos pelo concierge Inná — só o que estiver
    /// cadastrado aqui é respondido ao hóspede (nada é inventado).
    pub wifi_nome: Option<String>,
    pub wifi_senha: Option<String>,
    pub horario_checkin: Option<String>,
    pub horario_checkout: Option<String>,
    pub horario_cafe: Option<String>,
    pub info_servicos: Option<String>,
    /// Registro Cadastur/MTur — exibido em comunicações e no site.
    pub cadastur: Option<String>,
    /// CDC: política de cancelamento escalonada —
    /// `{"faixas":[{"ate_dias":15,"pct":100},{"ate_dias":7,"pct":50},{"ate_dias":0,"pct":0}]}`.
    pub politica_cancelamento: serde_json::Value,
    /// LGPD: anos de guarda após o check-out antes de anonimizar (art. 16).
    pub retencao_dados_anos: i32,
    /// LGPD: contato do encarregado (DPO) publicado na política de privacidade.
    pub dpo_email: Option<String>,
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
