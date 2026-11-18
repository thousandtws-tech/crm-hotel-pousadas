//! Persistência de verificações de identidade — sessões Didit por
//! funcionário e inbox de eventos de webhook.

use async_trait::async_trait;
use clarituz_domain::entities::{VerificacaoIdentidade, VerificacaoListItem};
use clarituz_domain::error::DomainError;
use clarituz_domain::ports::{NovaVerificacao, VerificacaoRepository};
use clarituz_shared::{Page, PageParams};
use sqlx::PgPool;
use uuid::Uuid;

const COLS: &str = "id, integracao_id, funcionario_id, session_id, url,
                    vendor_data, status, status_remoto, resumo, decidido_em,
                    criado_em, atualizado_em";

pub struct PgVerificacaoRepository {
    pool: PgPool,
}

impl PgVerificacaoRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl VerificacaoRepository for PgVerificacaoRepository {
    async fn criar(&self, nova: &NovaVerificacao) -> Result<VerificacaoIdentidade, DomainError> {
        sqlx::query_as::<_, VerificacaoIdentidade>(&format!(
            "INSERT INTO verificacao_identidade
                (integracao_id, funcionario_id, session_id, url, vendor_data)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING {COLS}"
        ))
        .bind(nova.integracao_id)
        .bind(nova.funcionario_id)
        .bind(&nova.session_id)
        .bind(&nova.url)
        .bind(&nova.vendor_data)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| {
            tracing::error!(erro = %e, "verificacao: falha ao criar sessão");
            DomainError::Infra
        })
    }

    async fn por_id(&self, id: Uuid) -> Result<Option<VerificacaoIdentidade>, DomainError> {
        sqlx::query_as::<_, VerificacaoIdentidade>(&format!(
            "SELECT {COLS} FROM verificacao_identidade WHERE id = $1"
        ))
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| {
            tracing::error!(erro = %e, "verificacao: falha ao buscar por id");
            DomainError::Infra
        })
    }

    async fn por_session(
        &self,
        session_id: &str,
    ) -> Result<Option<VerificacaoIdentidade>, DomainError> {
        sqlx::query_as::<_, VerificacaoIdentidade>(&format!(
            "SELECT {COLS} FROM verificacao_identidade WHERE session_id = $1"
        ))
        .bind(session_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| {
            tracing::error!(erro = %e, "verificacao: falha ao buscar por session_id");
            DomainError::Infra
        })
    }

    async fn viva(
        &self,
        funcionario_id: i64,
        integracao_id: i64,
    ) -> Result<Option<VerificacaoIdentidade>, DomainError> {
        sqlx::query_as::<_, VerificacaoIdentidade>(&format!(
            "SELECT {COLS} FROM verificacao_identidade
             WHERE funcionario_id = $1 AND integracao_id = $2
               AND status NOT IN ('aprovada','recusada','expirada','abandonada','kyc_expirada')
             ORDER BY criado_em DESC LIMIT 1"
        ))
        .bind(funcionario_id)
        .bind(integracao_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| {
            tracing::error!(erro = %e, "verificacao: falha ao buscar sessão viva");
            DomainError::Infra
        })
    }

    async fn atual(
        &self,
        funcionario_id: i64,
        integracao_id: i64,
    ) -> Result<Option<VerificacaoIdentidade>, DomainError> {
        sqlx::query_as::<_, VerificacaoIdentidade>(&format!(
            "SELECT {COLS} FROM verificacao_identidade
             WHERE funcionario_id = $1 AND integracao_id = $2
             ORDER BY criado_em DESC LIMIT 1"
        ))
        .bind(funcionario_id)
        .bind(integracao_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| {
            tracing::error!(erro = %e, "verificacao: falha ao buscar status atual");
            DomainError::Infra
        })
    }

    async fn listar(
        &self,
        page: PageParams,
        integracao_id: i64,
    ) -> Result<Page<VerificacaoListItem>, DomainError> {
        let itens = sqlx::query_as::<_, VerificacaoListItem>(
            "SELECT v.id, v.integracao_id, v.funcionario_id, v.session_id, v.url,
                    v.vendor_data, v.status, v.status_remoto, v.resumo,
                    v.decidido_em, v.criado_em, v.atualizado_em,
                    f.nome AS funcionario_nome, f.nivel AS funcionario_nivel
             FROM verificacao_identidade v
             JOIN funcionario f ON f.id = v.funcionario_id
             WHERE v.integracao_id = $1
             ORDER BY v.criado_em DESC
             LIMIT $2 OFFSET $3",
        )
        .bind(integracao_id)
        .bind(page.limit())
        .bind(page.offset())
        .fetch_all(&self.pool)
        .await
        .map_err(|e| {
            tracing::error!(erro = %e, "verificacao: falha ao listar");
            DomainError::Infra
        })?;

        let total: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM verificacao_identidade WHERE integracao_id = $1",
        )
        .bind(integracao_id)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| {
            tracing::error!(erro = %e, "verificacao: falha ao contar");
            DomainError::Infra
        })?;

        Ok(Page::new(itens, page, total))
    }

    async fn atualizar_status(
        &self,
        id: Uuid,
        status: &str,
        status_remoto: Option<&str>,
        resumo: &serde_json::Value,
        decidido: bool,
    ) -> Result<(), DomainError> {
        sqlx::query(
            "UPDATE verificacao_identidade
             SET status = $2,
                 status_remoto = COALESCE($3, status_remoto),
                 resumo = CASE WHEN $4 = '{}'::jsonb THEN resumo ELSE $4 END,
                 decidido_em = CASE WHEN $5 THEN COALESCE(decidido_em, now()) ELSE decidido_em END,
                 atualizado_em = now()
             WHERE id = $1",
        )
        .bind(id)
        .bind(status)
        .bind(status_remoto)
        .bind(resumo)
        .bind(decidido)
        .execute(&self.pool)
        .await
        .map_err(|e| {
            tracing::error!(erro = %e, "verificacao: falha ao atualizar status");
            DomainError::Infra
        })?;
        Ok(())
    }

    async fn inbox_inserir(
        &self,
        event_id: &str,
        session_id: Option<&str>,
        webhook_type: Option<&str>,
        payload: &serde_json::Value,
    ) -> Result<bool, DomainError> {
        let res = sqlx::query(
            "INSERT INTO verificacao_evento (event_id, session_id, webhook_type, payload)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (event_id) DO NOTHING",
        )
        .bind(event_id)
        .bind(session_id)
        .bind(webhook_type)
        .bind(payload)
        .execute(&self.pool)
        .await
        .map_err(|e| {
            tracing::error!(erro = %e, "verificacao: falha ao persistir evento");
            DomainError::Infra
        })?;
        Ok(res.rows_affected() > 0)
    }

    async fn inbox_marcar_processado(&self, event_id: &str) -> Result<(), DomainError> {
        sqlx::query("UPDATE verificacao_evento SET processado_em = now() WHERE event_id = $1")
            .bind(event_id)
            .execute(&self.pool)
            .await
            .map_err(|e| {
                tracing::error!(erro = %e, "verificacao: falha ao marcar evento");
                DomainError::Infra
            })?;
        Ok(())
    }
}
