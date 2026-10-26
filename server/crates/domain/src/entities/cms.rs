//! CMS de quartos — conteúdo editorial do site público, por acomodação.

use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct AcomodacaoCms {
    pub id: i64,
    pub idacomodacao: i64,
    pub slug: String,
    pub subtitulo: Option<String>,
    pub descricao_curta: Option<String>,
    pub descricao_longa: Option<String>,
    pub destaque_editorial: Option<String>,
    pub camas: Option<String>,
    pub banheiros: Option<i32>,
    pub metragem: Option<Decimal>,
    pub vista: Option<String>,
    pub andar: Option<String>,
    pub comodidades: serde_json::Value,
    pub status: String,
    pub destaque: bool,
    pub ordem: i32,
    pub publicado_em: Option<DateTime<Utc>>,
    pub version: i64,
    pub criado_em: DateTime<Utc>,
    pub atualizado_em: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct AcomodacaoMidia {
    pub id: i64,
    pub idacomodacao: i64,
    pub tipo: String,
    pub caminho: String,
    pub mime: String,
    pub capa: bool,
    pub ordem: i32,
    pub version: i64,
    pub criado_em: DateTime<Utc>,
}

/// Mídia exposta — nunca vaza `caminho` (path do filesystem); o front usa
/// `/api/v1/midia/{id}` como URL pública do binário.
#[derive(Debug, Clone, Serialize)]
pub struct MidiaView {
    pub id: i64,
    pub tipo: String,
    pub url: String,
    pub capa: bool,
    pub ordem: i32,
}

/// Acomodação + conteúdo CMS + mídias — view de admin (rascunho incluído).
#[derive(Debug, Clone, Serialize)]
pub struct AcomodacaoCmsView {
    #[serde(flatten)]
    pub acomodacao: crate::entities::Acomodacao,
    pub cms: Option<AcomodacaoCms>,
    pub midias: Vec<MidiaView>,
}

/// Card público do site — só `acomodacao` ativa + CMS `publicado`.
#[derive(Debug, Clone, Serialize)]
pub struct AcomodacaoPublica {
    pub id: i64,
    pub slug: String,
    pub nome: String,
    pub numero: i32,
    pub valor: Decimal,
    pub capacidade: i32,
    pub cor: Option<String>,
    pub subtitulo: Option<String>,
    pub descricao_curta: Option<String>,
    pub descricao_longa: Option<String>,
    pub destaque_editorial: Option<String>,
    pub camas: Option<String>,
    pub banheiros: Option<i32>,
    pub metragem: Option<Decimal>,
    pub vista: Option<String>,
    pub andar: Option<String>,
    pub comodidades: serde_json::Value,
    pub destaque: bool,
    pub ordem: i32,
    pub midias: Vec<MidiaView>,
}
