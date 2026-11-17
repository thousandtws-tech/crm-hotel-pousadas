use crate::entities::{
    AcomodacaoCms, AcomodacaoCmsView, AcomodacaoMidia, AcomodacaoPublica, CmsSecao, NovoLog,
};
use crate::error::DomainError;
use async_trait::async_trait;

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
    async fn listar_com_cms(&self) -> Result<Vec<AcomodacaoCmsView>, DomainError>;
    async fn buscar_cms(&self, idacomodacao: i64) -> Result<Option<AcomodacaoCms>, DomainError>;
    async fn slug_em_uso(&self, slug: &str, exceto_acom: i64) -> Result<bool, DomainError>;
    async fn salvar_cms(
        &self,
        idacomodacao: i64,
        dados: &ConteudoCms,
        log: NovoLog,
    ) -> Result<AcomodacaoCms, DomainError>;
    async fn definir_status(
        &self,
        idacomodacao: i64,
        status: &str,
        log: NovoLog,
    ) -> Result<AcomodacaoCms, DomainError>;

    async fn listar_midias(&self, idacomodacao: i64) -> Result<Vec<AcomodacaoMidia>, DomainError>;
    async fn caminho_midia(&self, id: i64) -> Result<Option<(String, String, bool)>, DomainError>;
    async fn adicionar_midia(
        &self,
        nova: &NovaMidia,
        log: NovoLog,
    ) -> Result<AcomodacaoMidia, DomainError>;
    async fn remover_midia(&self, id: i64, log: NovoLog) -> Result<Option<String>, DomainError>;
    async fn definir_capa(&self, id: i64, log: NovoLog) -> Result<(), DomainError>;
    async fn reordenar_midias(
        &self,
        idacomodacao: i64,
        ordem: &[i64],
        log: NovoLog,
    ) -> Result<(), DomainError>;

    async fn site_secoes(&self) -> Result<Vec<CmsSecao>, DomainError>;
    async fn site_salvar(
        &self,
        secao: &str,
        dados: &serde_json::Value,
        log: NovoLog,
    ) -> Result<CmsSecao, DomainError>;

    async fn newsletter_inscrever(&self, email: &str, origem: &str) -> Result<bool, DomainError>;

    async fn listar_publicadas(&self) -> Result<Vec<AcomodacaoPublica>, DomainError>;
    async fn publicada_por_slug(
        &self,
        slug: &str,
    ) -> Result<Option<AcomodacaoPublica>, DomainError>;
}
