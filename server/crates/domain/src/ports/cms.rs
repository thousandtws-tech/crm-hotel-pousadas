//! Port do CMS de quartos — conteúdo editorial e mídia do site público.

use crate::entities::{
    AcomodacaoCms, AcomodacaoCmsView, AcomodacaoMidia, AcomodacaoPublica, CmsSecao, NovoLog,
    SiteMidia,
};
use crate::error::DomainError;
use async_trait::async_trait;

/// Dados editáveis do conteúdo CMS. `Option<String>` interno já chega
/// normalizado pelo service (trim + "" → NULL).
#[derive(Debug, Clone, Default)]
pub struct ConteudoCms {
    pub slug: String,
    pub subtitulo: Option<String>,
    pub descricao_curta: Option<String>,
    pub descricao_longa: Option<String>,
    pub destaque_editorial: Option<String>,
    pub camas: Option<String>,
    pub banheiros: Option<i32>,
    pub metragem: Option<rust_decimal::Decimal>,
    pub vista: Option<String>,
    pub andar: Option<String>,
    pub comodidades: serde_json::Value,
    pub destaque: bool,
    pub ordem: i32,
    /// Concorrência otimista — só quando a linha CMS já existe.
    pub version: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct NovaMidia {
    pub idacomodacao: i64,
    pub tipo: String,
    pub caminho: String,
    pub mime: String,
}

#[async_trait]
pub trait CmsRepository: Send + Sync {
    /// Acomodação + CMS + mídias — view admin (qualquer status).
    async fn listar_com_cms(&self) -> Result<Vec<AcomodacaoCmsView>, DomainError>;
    async fn buscar_cms(&self, idacomodacao: i64) -> Result<Option<AcomodacaoCms>, DomainError>;
    async fn slug_em_uso(&self, slug: &str, exceto_acom: i64) -> Result<bool, DomainError>;
    /// Upsert editorial — cria rascunho ou atualiza (com optimistic locking).
    async fn salvar_cms(
        &self,
        idacomodacao: i64,
        dados: &ConteudoCms,
        log: NovoLog,
    ) -> Result<AcomodacaoCms, DomainError>;
    /// `publicado`/`rascunho` — carimba `publicado_em` ao publicar.
    async fn definir_status(
        &self,
        idacomodacao: i64,
        status: &str,
        log: NovoLog,
    ) -> Result<AcomodacaoCms, DomainError>;

    async fn listar_midias(&self, idacomodacao: i64) -> Result<Vec<AcomodacaoMidia>, DomainError>;
    /// `(caminho, mime, publicado)` da mídia — `publicado` reflete o status
    /// do CMS da acomodação dona (rascunho não vaza para o site).
    async fn caminho_midia(&self, id: i64) -> Result<Option<(String, String, bool)>, DomainError>;
    /// Registra mídia; a primeira foto vira capa automaticamente.
    async fn adicionar_midia(
        &self,
        nova: &NovaMidia,
        log: NovoLog,
    ) -> Result<AcomodacaoMidia, DomainError>;
    /// Remove metadados — retorna o `caminho` para o chamador apagar o arquivo.
    async fn remover_midia(&self, id: i64, log: NovoLog) -> Result<Option<String>, DomainError>;
    /// Torna a mídia `id` a capa da acomodação (desmarca a anterior).
    async fn definir_capa(&self, id: i64, log: NovoLog) -> Result<(), DomainError>;
    async fn reordenar_midias(
        &self,
        idacomodacao: i64,
        ordem: &[i64],
        log: NovoLog,
    ) -> Result<(), DomainError>;

    /// Seções editáveis do site (hero/seo/faq…) — admin: todas.
    async fn site_secoes(&self) -> Result<Vec<CmsSecao>, DomainError>;
    /// Upsert de uma seção do site por nome.
    async fn site_salvar(
        &self,
        secao: &str,
        dados: &serde_json::Value,
        log: NovoLog,
    ) -> Result<CmsSecao, DomainError>;
    /// Alterna a visibilidade pública da seção (cria a linha se ausente).
    async fn site_definir_visivel(
        &self,
        secao: &str,
        visivel: bool,
        log: NovoLog,
    ) -> Result<CmsSecao, DomainError>;

    // -- biblioteca de mídia do site ------------------------------------------

    async fn site_midias(&self) -> Result<Vec<SiteMidia>, DomainError>;
    /// Registra a mídia já gravada no storage (chave `site/…`).
    async fn site_midia_adicionar(
        &self,
        tipo: &str,
        caminho: &str,
        mime: &str,
        nome: &str,
        log: NovoLog,
    ) -> Result<SiteMidia, DomainError>;
    /// Remove o metadado — retorna `caminho` para o chamador apagar o objeto.
    async fn site_midia_remover(
        &self,
        id: i64,
        log: NovoLog,
    ) -> Result<Option<String>, DomainError>;
    /// `(caminho, mime)` para servir o binário público.
    async fn site_midia_caminho(&self, id: i64)
        -> Result<Option<(String, String)>, DomainError>;

    /// Cards `publicado` + acomodacao ativa — consumo do site público.
    async fn listar_publicadas(&self) -> Result<Vec<AcomodacaoPublica>, DomainError>;
    async fn publicada_por_slug(
        &self,
        slug: &str,
    ) -> Result<Option<AcomodacaoPublica>, DomainError>;
}
