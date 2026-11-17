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
    /// Config não-secreta (Z-API: `{"instance_id": "…"}`) — merge por chave.
    #[serde(default)]
    pub config: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct MensagemTesteInput {
    pub telefone: String,
    #[serde(default)]
    pub texto: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct HabilitacaoInput {
    pub habilitado: bool,
}
