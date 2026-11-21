use super::de::de_decimal_opt;
use rust_decimal::Decimal;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct EstabelecimentoInput {
    pub cnpj: Option<String>,
    pub razao_social: Option<String>,
    pub site: Option<String>,
    pub email: Option<String>,
    pub telefone: Option<String>,
    pub celular: Option<String>,
    pub impressora_ip: Option<String>,
    pub impressora_porta: Option<i32>,
    pub impressora_ativa: Option<bool>,
    /// Taxas early/late em R$ — entram no total usado no cálculo do sinal.
    #[serde(default, deserialize_with = "de_decimal_opt")]
    pub taxa_early: Option<Decimal>,
    #[serde(default, deserialize_with = "de_decimal_opt")]
    pub taxa_late: Option<Decimal>,
    /// Dados factuais do concierge Inná (Wi-Fi, horários, serviços).
    pub wifi_nome: Option<String>,
    pub wifi_senha: Option<String>,
    pub horario_checkin: Option<String>,
    pub horario_checkout: Option<String>,
    pub horario_cafe: Option<String>,
    pub info_servicos: Option<String>,
    /// MTur/Cadastur — exibido no site e nas comunicações.
    pub cadastur: Option<String>,
    /// CDC: faixas escalonadas `[{"ate_dias":15,"pct":100},…]` — ordenadas
    /// do prazo mais distante ao mais próximo do check-in.
    pub politica_cancelamento: Option<serde_json::Value>,
    /// LGPD: anos de guarda pós check-out antes de anonimizar.
    pub retencao_dados_anos: Option<i32>,
    /// LGPD: e-mail do encarregado (DPO) na política de privacidade.
    pub dpo_email: Option<String>,
    /// Link de avaliação do Google — convite ao hóspede promotor.
    pub google_review_url: Option<String>,
    /// MTur: exige assinatura desenhada na pré-ficha pública.
    pub fnrh_assinatura: Option<bool>,
    /// Fechamento: PIN gerencial para autorizar no-show (vazio = mantém).
    pub pin_fechamento: Option<String>,
    /// Concorrência otimista.
    pub version: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct EnderecoInput {
    pub logradouro: Option<String>,
    pub numero: Option<String>,
    pub complemento: Option<String>,
    pub bairro: Option<String>,
    pub cidade: Option<String>,
    pub cep: Option<String>,
    /// Concorrência otimista.
    pub version: Option<i64>,
}
