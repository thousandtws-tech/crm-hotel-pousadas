//! `notificacao` — histórico do inbox (read model do EventBus).

use crate::persistence::db::map_db_err;
use async_trait::async_trait;
use clarituz_domain::entities::Notificacao;
use clarituz_domain::events::Aviso;
use clarituz_domain::ports::NotificacaoRepository;
use clarituz_domain::DomainError;
use clarituz_shared::{Page, PageParams};
use sqlx::PgPool;

pub struct PgNotificacaoRepository {
    pool: PgPool,
}

impl PgNotificacaoRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl NotificacaoRepository for PgNotificacaoRepository {
    async fn registrar(&self, aviso: &Aviso) -> Result<i64, DomainError> {
        sqlx::query_scalar(
            "INSERT INTO notificacao (tipo, titulo, mensagem, ate_nivel, autor_id, autor_nome, dados)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
        )
        .bind(serde_json::to_string(&aviso.tipo).unwrap_or_default().trim_matches('"').to_string())
        .bind(&aviso.titulo)
        .bind(&aviso.mensagem)
        .bind(aviso.ate_nivel)
        .bind(aviso.autor_id)
        .bind(&aviso.autor_nome)
        .bind(&aviso.dados)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn inbox(
        &self,
        idfuncionario: i64,
        nivel: i16,
        page: PageParams,
    ) -> Result<Page<Notificacao>, DomainError> {
        let total: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM notificacao WHERE ate_nivel >= $1")
                .bind(nivel)
                .fetch_one(&self.pool)
                .await
                .map_err(map_db_err)?;

        let items = sqlx::query_as::<_, Notificacao>(
            "SELECT n.id, n.tipo, n.titulo, n.mensagem, n.autor_nome, n.dados,
                    n.criado_em,
                    (nl.idfuncionario IS NOT NULL) AS lida
             FROM notificacao n
             LEFT JOIN notificacao_lida nl
                    ON nl.idnotificacao = n.id AND nl.idfuncionario = $1
             WHERE n.ate_nivel >= $2
             ORDER BY n.id DESC
             LIMIT $3 OFFSET $4",
        )
        .bind(idfuncionario)
        .bind(nivel)
        .bind(page.limit())
        .bind(page.offset())
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)?;

        Ok(Page::new(items, page, total))
    }

    async fn nao_lidas(&self, idfuncionario: i64, nivel: i16) -> Result<i64, DomainError> {
        sqlx::query_scalar(
            "SELECT COUNT(*) FROM notificacao n
             WHERE n.ate_nivel >= $2
               AND NOT EXISTS (
                   SELECT 1 FROM notificacao_lida nl
                   WHERE nl.idnotificacao = n.id AND nl.idfuncionario = $1)",
        )
        .bind(idfuncionario)
        .bind(nivel)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn marcar_lida(&self, idnotificacao: i64, idfuncionario: i64) -> Result<(), DomainError> {
        sqlx::query(
            "INSERT INTO notificacao_lida (idnotificacao, idfuncionario)
             VALUES ($1, $2) ON CONFLICT DO NOTHING",
        )
        .bind(idnotificacao)
        .bind(idfuncionario)
        .execute(&self.pool)
        .await
        .map_err(map_db_err)?;
        Ok(())
    }

    async fn marcar_todas(&self, idfuncionario: i64, nivel: i16) -> Result<u64, DomainError> {
        let r = sqlx::query(
            "INSERT INTO notificacao_lida (idnotificacao, idfuncionario)
             SELECT n.id, $1 FROM notificacao n
             WHERE n.ate_nivel >= $2
               AND NOT EXISTS (
                   SELECT 1 FROM notificacao_lida nl
                   WHERE nl.idnotificacao = n.id AND nl.idfuncionario = $1)
             ON CONFLICT DO NOTHING",
        )
        .bind(idfuncionario)
        .bind(nivel)
        .execute(&self.pool)
        .await
        .map_err(map_db_err)?;
        Ok(r.rows_affected())
    }

    async fn excluir(&self, id: i64) -> Result<bool, DomainError> {
        let r = sqlx::query("DELETE FROM notificacao WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(map_db_err)?;
        Ok(r.rows_affected() > 0)
    }
}
