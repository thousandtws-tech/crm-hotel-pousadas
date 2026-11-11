//! Adapter Postgres do CMS — conteúdo editorial e mídia das acomodações.

use super::audit;
use crate::persistence::db::map_db_err;
use async_trait::async_trait;
use clarituz_domain::entities::{
    Acomodacao, AcomodacaoCms, AcomodacaoCmsView, AcomodacaoMidia, AcomodacaoPublica, CmsSecao,
    MidiaView, NovoLog,
};
use clarituz_domain::ports::{CmsRepository, ConteudoCms, NovaMidia};
use clarituz_domain::DomainError;
use sqlx::PgPool;

const CMS_COLS: &str = "id, idacomodacao, slug, subtitulo, descricao_curta, descricao_longa,
    destaque_editorial, camas, banheiros, metragem, vista, andar, comodidades,
    status, destaque, ordem, publicado_em, version, criado_em, atualizado_em";

const MIDIA_COLS: &str = "id, idacomodacao, tipo, caminho, mime, capa, ordem, version, criado_em";

const ACOM_COLS: &str = "id, idtipo_acomodacao, nome, numero, valor, capacidade,
    descricao, cor, ativo, version, criado_em, atualizado_em";

fn midia_view(m: AcomodacaoMidia) -> MidiaView {
    MidiaView {
        id: m.id,
        tipo: m.tipo,
        url: format!("/api/v1/midia/{}", m.id),
        capa: m.capa,
        ordem: m.ordem,
    }
}

async fn midias_view(pool: &PgPool, idacomodacao: i64) -> Result<Vec<MidiaView>, DomainError> {
    let rows = sqlx::query_as::<_, AcomodacaoMidia>(&format!(
        "SELECT {MIDIA_COLS} FROM acomodacao_midia
         WHERE idacomodacao = $1 ORDER BY ordem, id"
    ))
    .bind(idacomodacao)
    .fetch_all(pool)
    .await
    .map_err(map_db_err)?;
    Ok(rows.into_iter().map(midia_view).collect())
}

#[derive(Clone)]
pub struct PgCmsRepository {
    pool: PgPool,
}
impl PgCmsRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl CmsRepository for PgCmsRepository {
    async fn listar_com_cms(&self) -> Result<Vec<AcomodacaoCmsView>, DomainError> {
        let acoms = sqlx::query_as::<_, Acomodacao>(&format!(
            "SELECT {ACOM_COLS} FROM acomodacao ORDER BY numero"
        ))
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)?;

        let mut out = Vec::with_capacity(acoms.len());
        for a in acoms {
            let cms = sqlx::query_as::<_, AcomodacaoCms>(&format!(
                "SELECT {CMS_COLS} FROM acomodacao_cms WHERE idacomodacao = $1"
            ))
            .bind(a.id)
            .fetch_optional(&self.pool)
            .await
            .map_err(map_db_err)?;
            let midias = midias_view(&self.pool, a.id).await?;
            out.push(AcomodacaoCmsView {
                acomodacao: a,
                cms,
                midias,
            });
        }
        Ok(out)
    }

    async fn buscar_cms(&self, idacomodacao: i64) -> Result<Option<AcomodacaoCms>, DomainError> {
        sqlx::query_as::<_, AcomodacaoCms>(&format!(
            "SELECT {CMS_COLS} FROM acomodacao_cms WHERE idacomodacao = $1"
        ))
        .bind(idacomodacao)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn slug_em_uso(&self, slug: &str, exceto_acom: i64) -> Result<bool, DomainError> {
        sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM acomodacao_cms WHERE slug = $1 AND idacomodacao <> $2)",
        )
        .bind(slug)
        .bind(exceto_acom)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn salvar_cms(
        &self,
        idacomodacao: i64,
        d: &ConteudoCms,
        log: NovoLog,
    ) -> Result<AcomodacaoCms, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let row = sqlx::query_as::<_, AcomodacaoCms>(&format!(
            "INSERT INTO acomodacao_cms
                (idacomodacao, slug, subtitulo, descricao_curta, descricao_longa,
                 destaque_editorial, camas, banheiros, metragem, vista, andar,
                 comodidades, destaque, ordem)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
             ON CONFLICT (idacomodacao) DO UPDATE SET
                slug = EXCLUDED.slug, subtitulo = EXCLUDED.subtitulo,
                descricao_curta = EXCLUDED.descricao_curta,
                descricao_longa = EXCLUDED.descricao_longa,
                destaque_editorial = EXCLUDED.destaque_editorial,
                camas = EXCLUDED.camas, banheiros = EXCLUDED.banheiros,
                metragem = EXCLUDED.metragem, vista = EXCLUDED.vista,
                andar = EXCLUDED.andar, comodidades = EXCLUDED.comodidades,
                destaque = EXCLUDED.destaque, ordem = EXCLUDED.ordem,
                atualizado_em = now()
             WHERE ($15::bigint IS NULL OR acomodacao_cms.version = $15)
             RETURNING {CMS_COLS}"
        ))
        .bind(idacomodacao)
        .bind(&d.slug)
        .bind(&d.subtitulo)
        .bind(&d.descricao_curta)
        .bind(&d.descricao_longa)
        .bind(&d.destaque_editorial)
        .bind(&d.camas)
        .bind(d.banheiros)
        .bind(d.metragem)
        .bind(&d.vista)
        .bind(&d.andar)
        .bind(&d.comodidades)
        .bind(d.destaque)
        .bind(d.ordem)
        .bind(d.version)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| {
            DomainError::conflito(
                "Conteúdo alterado por outro usuário. Recarregue e tente novamente.",
            )
        })?;
        let mut log = log;
        log.idtabela = row.id;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(row)
    }

    async fn definir_status(
        &self,
        idacomodacao: i64,
        status: &str,
        log: NovoLog,
    ) -> Result<AcomodacaoCms, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let row = sqlx::query_as::<_, AcomodacaoCms>(&format!(
            "UPDATE acomodacao_cms SET
                status = $2,
                publicado_em = CASE WHEN $2 = 'publicado' THEN now() ELSE publicado_em END,
                atualizado_em = now()
             WHERE idacomodacao = $1 RETURNING {CMS_COLS}"
        ))
        .bind(idacomodacao)
        .bind(status)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| DomainError::nao_encontrado("CMS da acomodação não encontrado."))?;
        let mut log = log;
        log.idtabela = row.id;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(row)
    }

    async fn listar_midias(&self, idacomodacao: i64) -> Result<Vec<AcomodacaoMidia>, DomainError> {
        sqlx::query_as::<_, AcomodacaoMidia>(&format!(
            "SELECT {MIDIA_COLS} FROM acomodacao_midia
             WHERE idacomodacao = $1 ORDER BY ordem, id"
        ))
        .bind(idacomodacao)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn caminho_midia(&self, id: i64) -> Result<Option<(String, String, bool)>, DomainError> {
        sqlx::query_as::<_, (String, String, bool)>(
            "SELECT m.caminho, m.mime,
                    COALESCE(c.status = 'publicado', FALSE) AS publicado
             FROM acomodacao_midia m
             LEFT JOIN acomodacao_cms c ON c.idacomodacao = m.idacomodacao
             WHERE m.id = $1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn adicionar_midia(
        &self,
        n: &NovaMidia,
        log: NovoLog,
    ) -> Result<AcomodacaoMidia, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let row = sqlx::query_as::<_, AcomodacaoMidia>(&format!(
            "INSERT INTO acomodacao_midia (idacomodacao, tipo, caminho, mime, capa, ordem)
             VALUES ($1, $2, $3, $4,
                     $2 = 'foto' AND NOT EXISTS(
                         SELECT 1 FROM acomodacao_midia WHERE idacomodacao = $1 AND capa),
                     COALESCE((SELECT MAX(ordem) + 1 FROM acomodacao_midia
                               WHERE idacomodacao = $1), 0))
             RETURNING {MIDIA_COLS}"
        ))
        .bind(n.idacomodacao)
        .bind(&n.tipo)
        .bind(&n.caminho)
        .bind(&n.mime)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;
        let mut log = log;
        log.idtabela = row.id;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(row)
    }

    async fn remover_midia(&self, id: i64, log: NovoLog) -> Result<Option<String>, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let row = sqlx::query_as::<_, AcomodacaoMidia>(&format!(
            "DELETE FROM acomodacao_midia WHERE id = $1 RETURNING {MIDIA_COLS}"
        ))
        .bind(id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?;
        let Some(row) = row else { return Ok(None) };
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(Some(row.caminho))
    }

    async fn definir_capa(&self, id: i64, log: NovoLog) -> Result<(), DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let m = sqlx::query_as::<_, AcomodacaoMidia>(&format!(
            "UPDATE acomodacao_midia SET capa = TRUE WHERE id = $1 AND tipo = 'foto'
             RETURNING {MIDIA_COLS}"
        ))
        .bind(id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| DomainError::nao_encontrado("Foto não encontrada."))?;
        sqlx::query(
            "UPDATE acomodacao_midia SET capa = FALSE
             WHERE idacomodacao = $1 AND id <> $2 AND capa",
        )
        .bind(m.idacomodacao)
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(map_db_err)?;
        let mut log = log;
        log.idtabela = id;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(())
    }

    async fn reordenar_midias(
        &self,
        idacomodacao: i64,
        ordem: &[i64],
        log: NovoLog,
    ) -> Result<(), DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        for (idx, midia_id) in ordem.iter().enumerate() {
            sqlx::query(
                "UPDATE acomodacao_midia SET ordem = $1
                 WHERE id = $2 AND idacomodacao = $3",
            )
            .bind(idx as i32)
            .bind(midia_id)
            .bind(idacomodacao)
            .execute(&mut *tx)
            .await
            .map_err(map_db_err)?;
        }
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(())
    }

    async fn site_secoes(&self) -> Result<Vec<CmsSecao>, DomainError> {
        sqlx::query_as::<_, CmsSecao>(
            "SELECT id, secao, dados, ordem, visivel, atualizado_em
             FROM cms_site ORDER BY ordem, secao",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn site_salvar(
        &self,
        secao: &str,
        dados: &serde_json::Value,
        log: NovoLog,
    ) -> Result<CmsSecao, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let s = sqlx::query_as::<_, CmsSecao>(
            "INSERT INTO cms_site (secao, dados)
             VALUES ($1, $2)
             ON CONFLICT (secao) DO UPDATE
                SET dados = $2, atualizado_em = now()
             RETURNING id, secao, dados, ordem, visivel, atualizado_em",
        )
        .bind(secao)
        .bind(dados)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;
        let mut log = log;
        log.idtabela = s.id;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(s)
    }

    async fn newsletter_inscrever(&self, email: &str, origem: &str) -> Result<bool, DomainError> {
        // Conflito com ativo=true → já inscrito (false); ativo=false → reativa (true).
        let row = sqlx::query(
            "INSERT INTO newsletter_inscricao (email, origem) VALUES ($1, $2)
             ON CONFLICT (email) DO UPDATE
                SET ativo = true
                WHERE newsletter_inscricao.ativo = false
             RETURNING id",
        )
        .bind(email)
        .bind(origem)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)?;
        Ok(row.is_some())
    }

    async fn listar_publicadas(&self) -> Result<Vec<AcomodacaoPublica>, DomainError> {
        let rows = sqlx::query(
            "SELECT a.id, c.slug, a.nome, a.numero, a.valor, a.capacidade, a.cor,
                    c.subtitulo, c.descricao_curta, c.descricao_longa, c.destaque_editorial,
                    c.camas, c.banheiros, c.metragem, c.vista, c.andar, c.comodidades,
                    c.destaque, c.ordem, a.id AS idacomodacao
             FROM acomodacao_cms c
             JOIN acomodacao a ON a.id = c.idacomodacao AND a.ativo
             WHERE c.status = 'publicado'
             ORDER BY c.destaque DESC, c.ordem, a.numero",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)?;

        let mut out = Vec::with_capacity(rows.len());
        for r in rows {
            use sqlx::Row;
            let idacom: i64 = r.get("idacomodacao");
            out.push(AcomodacaoPublica {
                id: r.get("id"),
                slug: r.get("slug"),
                nome: r.get("nome"),
                numero: r.get("numero"),
                valor: r.get("valor"),
                capacidade: r.get("capacidade"),
                cor: r.get("cor"),
                subtitulo: r.get("subtitulo"),
                descricao_curta: r.get("descricao_curta"),
                descricao_longa: r.get("descricao_longa"),
                destaque_editorial: r.get("destaque_editorial"),
                camas: r.get("camas"),
                banheiros: r.get("banheiros"),
                metragem: r.get("metragem"),
                vista: r.get("vista"),
                andar: r.get("andar"),
                comodidades: r.get("comodidades"),
                destaque: r.get("destaque"),
                ordem: r.get("ordem"),
                midias: midias_view(&self.pool, idacom).await?,
            });
        }
        Ok(out)
    }

    async fn publicada_por_slug(
        &self,
        slug: &str,
    ) -> Result<Option<AcomodacaoPublica>, DomainError> {
        use sqlx::Row;

        let r = sqlx::query(
            "SELECT a.id, c.slug, a.nome, a.numero, a.valor, a.capacidade, a.cor,
                    c.subtitulo, c.descricao_curta, c.descricao_longa, c.destaque_editorial,
                    c.camas, c.banheiros, c.metragem, c.vista, c.andar, c.comodidades,
                    c.destaque, c.ordem, a.id AS idacomodacao
             FROM acomodacao_cms c
             JOIN acomodacao a ON a.id = c.idacomodacao AND a.ativo
             WHERE c.status = 'publicado' AND c.slug = $1",
        )
        .bind(slug)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)?;

        let Some(r) = r else { return Ok(None) };
        let idacom: i64 = r.get("idacomodacao");
        Ok(Some(AcomodacaoPublica {
            id: r.get("id"),
            slug: r.get("slug"),
            nome: r.get("nome"),
            numero: r.get("numero"),
            valor: r.get("valor"),
            capacidade: r.get("capacidade"),
            cor: r.get("cor"),
            subtitulo: r.get("subtitulo"),
            descricao_curta: r.get("descricao_curta"),
            descricao_longa: r.get("descricao_longa"),
            destaque_editorial: r.get("destaque_editorial"),
            camas: r.get("camas"),
            banheiros: r.get("banheiros"),
            metragem: r.get("metragem"),
            vista: r.get("vista"),
            andar: r.get("andar"),
            comodidades: r.get("comodidades"),
            destaque: r.get("destaque"),
            ordem: r.get("ordem"),
            midias: midias_view(&self.pool, idacom).await?,
        }))
    }
}
