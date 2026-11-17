use serde::Deserialize;
use std::collections::HashMap;

#[derive(Debug, Deserialize)]
pub struct SalvarIntegracaoInput {
    pub versao: i32,
    pub segredos: Option<HashMap<String, String>>,
    #[serde(default)]
    pub nome_conta: Option<String>,
    #[serde(default)]
    pub webhook_url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct HabilitacaoInput {
    pub habilitado: bool,
}
