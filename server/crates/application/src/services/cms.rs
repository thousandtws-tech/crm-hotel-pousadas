//! Casos de uso do CMS de quartos — conteúdo editorial, mídia e publicação.

use crate::actor::Ator;
use crate::dto::CmsInput;
use crate::error::AppResult;
use clarituz_domain::entities::{
    AcomodacaoCms, AcomodacaoCmsView, AcomodacaoMidia, AcomodacaoPublica,
};
use clarituz_domain::ports::{AcomodacaoRepository, CmsRepository, ConteudoCms, NovaMidia};
use clarituz_domain::DomainError;
use std::sync::Arc;

pub struct CmsService {
    cms: Arc<dyn CmsRepository>,
    acomodacoes: Arc<dyn AcomodacaoRepository>,
}

/// Slug URL-safe: minúsculas, sem acento, só `[a-z0-9-]`.
pub fn slugify(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut last_dash = false;
    for c in s.trim().to_lowercase().chars() {
        let c = match c {
            'á' | 'à' | 'â' | 'ã' | 'ä' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'í' | 'ì' | 'î' | 'ï' => 'i',
            'ó' | 'ò' | 'ô' | 'õ' | 'ö' => 'o',
            'ú' | 'ù' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            'ñ' => 'n',
            other => other,
        };
        if c.is_ascii_alphanumeric() {
            out.push(c);
            last_dash = false;
        } else if !last_dash && !out.is_empty() {
            out.push('-');
            last_dash = true;
        }
    }
    out.trim_end_matches('-').to_string()
}

fn vazio(s: &Option<String>) -> Option<String> {
    s.as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
}

impl CmsService {
    pub fn new(cms: Arc<dyn CmsRepository>, acomodacoes: Arc<dyn AcomodacaoRepository>) -> Self {
        Self { cms, acomodacoes }
    }

    // -- admin ----------------------------------------------------------------

    pub async fn listar(&self) -> AppResult<Vec<AcomodacaoCmsView>> {
        Ok(self.cms.listar_com_cms().await?)
    }

    /// Cria/atualiza o conteúdo editorial de uma acomodação (admin-only).
    /// `slug` vazio → deriva do nome da acomodação; duplicado → 409.
    pub async fn salvar(
        &self,
        ator: &Ator,
        idacomodacao: i64,
        input: CmsInput,
    ) -> AppResult<AcomodacaoCms> {
        ator.exigir_admin()?;
        let acom = self
            .acomodacoes
            .buscar(idacomodacao)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Acomodação não encontrada."))?;

        let slug = match vazio(&input.slug) {
            Some(s) => slugify(&s),
            None => slugify(&acom.nome),
        };
        if slug.is_empty() || slug.len() > 80 {
            return Err(DomainError::validacao("Slug inválido.").into());
        }
        if self.cms.slug_em_uso(&slug, idacomodacao).await? {
            return Err(DomainError::conflito(
                "Este slug já está em uso por outra acomodação.",
            )
            .into());
        }
        if let Some(b) = input.banheiros {
            if b < 0 || b > 20 {
                return Err(DomainError::validacao("Banheiros inválido.").into());
            }
        }
        if input.comodidades.as_ref().is_some_and(|c| !c.is_array()) {
            return Err(DomainError::validacao("Comodidades deve ser uma lista.").into());
        }

        let dados = ConteudoCms {
            slug: slug.clone(),
            subtitulo: vazio(&input.subtitulo),
            descricao_curta: vazio(&input.descricao_curta),
            descricao_longa: vazio(&input.descricao_longa),
            destaque_editorial: vazio(&input.destaque_editorial),
            camas: vazio(&input.camas),
            banheiros: input.banheiros,
            metragem: input.metragem,
            vista: vazio(&input.vista),
            andar: vazio(&input.andar),
            comodidades: input
                .comodidades
                .unwrap_or_else(|| serde_json::json!([])),
            destaque: input.destaque.unwrap_or(false),
            ordem: input.ordem.unwrap_or(0),
            version: input.version,
        };

        let log = ator.log(
            "edição",
            format!("Editou o conteúdo do site de '{}' (/{slug})", acom.nome),
            "acomodacao_cms",
            idacomodacao,
            None,
        );
        Ok(self.cms.salvar_cms(idacomodacao, &dados, log).await?)
    }

    /// Publica ou volta para rascunho (admin-only). Publicar exige o mínimo
    /// de conteúdo: subtítulo ou descrição curta.
    pub async fn publicar(
        &self,
        ator: &Ator,
        idacomodacao: i64,
        publicar: bool,
    ) -> AppResult<AcomodacaoCms> {
        ator.exigir_admin()?;
        let status = if publicar { "publicado" } else { "rascunho" };
        if publicar {
            let cms = self
                .cms
                .buscar_cms(idacomodacao)
                .await?
                .ok_or_else(|| {
                    DomainError::validacao("Salve o conteúdo antes de publicar.")
                })?;
            if cms.subtitulo.is_none() && cms.descricao_curta.is_none() {
                return Err(DomainError::validacao(
                    "Preencha ao menos o subtítulo ou a descrição curta antes de publicar.",
                )
                .into());
            }
        }
        let log = ator.log(
            "status",
            format!(
                "{} a acomodação Nº{idacomodacao} no site",
                if publicar { "Publicou" } else { "Despublicou" }
            ),
            "acomodacao_cms",
            idacomodacao,
            None,
        );
        Ok(self.cms.definir_status(idacomodacao, status, log).await?)
    }

    // -- mídia -----------------------------------------------------------------

    /// Registra metadados do arquivo já gravado no storage (admin-only).
    pub async fn adicionar_midia(
        &self,
        ator: &Ator,
        idacomodacao: i64,
        tipo: &str,
        caminho: &str,
        mime: &str,
    ) -> AppResult<AcomodacaoMidia> {
        ator.exigir_admin()?;
        let log = ator.log(
            "cadastro",
            format!("Adicionou {tipo} à acomodação Nº{idacomodacao}"),
            "acomodacao_midia",
            idacomodacao,
            None,
        );
        Ok(self
            .cms
            .adicionar_midia(
                &NovaMidia {
                    idacomodacao,
                    tipo: tipo.into(),
                    caminho: caminho.into(),
                    mime: mime.into(),
                },
                log,
            )
            .await?)
    }

    /// Remove mídia — retorna `caminho` p/ a rota apagar o arquivo (admin-only).
    pub async fn remover_midia(&self, ator: &Ator, id: i64) -> AppResult<Option<String>> {
        ator.exigir_admin()?;
        let log = ator.log(
            "exclusão",
            format!("Removeu a mídia Nº{id}"),
            "acomodacao_midia",
            id,
            None,
        );
        Ok(self.cms.remover_midia(id, log).await?)
    }

    pub async fn definir_capa(&self, ator: &Ator, id: i64) -> AppResult<()> {
        ator.exigir_admin()?;
        let log = ator.log(
            "edição",
            format!("Definiu a mídia Nº{id} como capa"),
            "acomodacao_midia",
            id,
            None,
        );
        Ok(self.cms.definir_capa(id, log).await?)
    }

    pub async fn reordenar_midias(
        &self,
        ator: &Ator,
        idacomodacao: i64,
        ordem: Vec<i64>,
    ) -> AppResult<()> {
        ator.exigir_admin()?;
        let log = ator.log(
            "edição",
            format!("Reordenou mídias da acomodação Nº{idacomodacao}"),
            "acomodacao_midia",
            idacomodacao,
            None,
        );
        Ok(self.cms.reordenar_midias(idacomodacao, &ordem, log).await?)
    }

    /// `(caminho, mime, publicado)` — usado pelos handlers que servem o
    /// binário (público exige `publicado`; admin ignora a flag).
    pub async fn caminho_midia(&self, id: i64) -> AppResult<Option<(String, String, bool)>> {
        Ok(self.cms.caminho_midia(id).await?)
    }

    // -- público ----------------------------------------------------------------

    pub async fn listar_publicadas(&self) -> AppResult<Vec<AcomodacaoPublica>> {
        Ok(self.cms.listar_publicadas().await?)
    }

    pub async fn publicada_por_slug(&self, slug: &str) -> AppResult<AcomodacaoPublica> {
        self.cms
            .publicada_por_slug(slug)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Acomodação não encontrada.").into())
    }
}
