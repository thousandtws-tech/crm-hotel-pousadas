use super::de::de_decimal_opt;
use rust_decimal::Decimal;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct CmsInput {
    pub slug: Option<String>,
    pub subtitulo: Option<String>,
    pub descricao_curta: Option<String>,
    pub descricao_longa: Option<String>,
    pub destaque_editorial: Option<String>,
    pub camas: Option<String>,
    pub banheiros: Option<i32>,
    #[serde(default, deserialize_with = "de_decimal_opt")]
    pub metragem: Option<Decimal>,
    pub vista: Option<String>,
    pub andar: Option<String>,
    pub comodidades: Option<serde_json::Value>,
    pub destaque: Option<bool>,
    pub ordem: Option<i32>,
    /// Concorrência otimista — só em update de CMS já existente.
    pub version: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct StatusCmsInput {
    pub publicar: bool,
}

#[derive(Debug, Deserialize)]
pub struct OrdenarMidiaInput {
    /// IDs das mídias na ordem desejada.
    pub ordem: Vec<i64>,
}
