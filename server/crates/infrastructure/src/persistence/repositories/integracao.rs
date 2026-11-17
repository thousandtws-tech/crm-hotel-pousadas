//! Repositório de integrações — configuração + segredos (envelopes) +
//! provedor padrão, com optimistic lock por `versao` e invalidação de
//! verificação a cada mudança.

use crate::persistence::db::map_db_err;
use async_trait::async_trait;
use clarituz_domain::entities::{
    AmbienteIntegracao, Integracao, ProvedorPagamento, StatusVerificacao,
};
use clarituz_domain::ports::{
    AtualizacaoIntegracao, IntegracaoRepository, MapaSegredos, NovaIntegracao,
};
use clarituz_domain::DomainError;
use sqlx::PgPool;
use std::collections::HashMap;

const COLS: &str = "id, provedor, ambiente, nome_conta, status, habilitado,
    capabilities, webhook_url, ultima_verificacao_em, verificacao_status,
    verificacao_erro, versao, criado_por, atualizado_por, criado_em, atualizado_em";

#[derive(Clone)]
pub struct PgIntegracaoRepository {
    pool: PgPool,
}

impl PgIntegracaoRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl IntegracaoRepository for PgIntegracaoRepository {
    async fn listar(&self) -> Result<Vec<Integracao>, DomainError> {
        sqlx::query_as::<_, Integracao>(&format!(
            "SELECT {COLS} FROM integracao ORDER BY provedor, ambiente"
        ))
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn buscar(
        &self,
        provedor: ProvedorPagamento,
        ambiente: AmbienteIntegracao,
    ) -> Result<Option<Integracao>, DomainError> {
        sqlx::query_as::<_, Integracao>(&format!(
            "SELECT {COLS} FROM integracao WHERE provedor = $1 AND ambiente = $2"
        ))
        .bind(provedor.as_str())
        .bind(ambiente.as_str())
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn buscar_por_id(&self, id: i64) -> Result<Option<Integracao>, DomainError> {
        sqlx::query_as::<_, Integracao>(&format!("SELECT {COLS} FROM integracao WHERE id = $1"))
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map_err(map_db_err)
    }

    async fn garantir(&self, nova: &NovaIntegracao) -> Result<Integracao, DomainError> {
        sqlx::query_as::<_, Integracao>(&format!(
            "INSERT INTO integracao (provedor, ambiente, criado_por)
             VALUES ($1, $2, $3)
             ON CONFLICT (provedor, ambiente) DO UPDATE SET provedor = EXCLUDED.provedor
             RETURNING {COLS}"
        ))
        .bind(nova.provedor.as_str())
        .bind(nova.ambiente.as_str())
        .bind(nova.criado_por)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn salvar(
        &self,
        id: i64,
        versao_esperada: i32,
        atual: &AtualizacaoIntegracao,
        segredos_enc: &HashMap<String, Vec<u8>>,
        atualizado_por: Option<i64>,
    ) -> Result<Integracao, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;

        // Optimistic lock: versao divergente = escrita concorrente obsoleta.
        let atualizada = sqlx::query_as::<_, Integracao>(&format!(
            "UPDATE integracao SET
                nome_conta = COALESCE($2, nome_conta),
                webhook_url = COALESCE($3, webhook_url),
                versao = versao + 1,
                ultima_verificacao_em = NULL,
                verificacao_status = NULL,
                verificacao_erro = NULL,
                atualizado_por = $4,
                atualizado_em = now()
             WHERE id = $1 AND versao = $5
             RETURNING {COLS}"
        ))
        .bind(id)
        .bind(&atual.nome_conta)
        .bind(&atual.webhook_url)
        .bind(atualizado_por)
        .bind(versao_esperada)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| {
            DomainError::conflito(
                "A configuração foi alterada por outro usuário. Recarregue antes de salvar.",
            )
        })?;

        for (campo, envelope) in segredos_enc {
            if envelope.is_empty() {
                // Envelope vazio = remoção explícita do campo.
                sqlx::query(
                    "DELETE FROM integracao_segredo WHERE idintegracao = $1 AND campo = $2",
                )
                .bind(id)
                .bind(campo)
                .execute(&mut *tx)
                .await
                .map_err(map_db_err)?;
            } else {
                sqlx::query(
                    "INSERT INTO integracao_segredo (idintegracao, campo, valor_enc)
                     VALUES ($1, $2, $3)
                     ON CONFLICT (idintegracao, campo)
                     DO UPDATE SET valor_enc = EXCLUDED.valor_enc,
                         versao_chave = integracao_segredo.versao_chave + 1,
                         atualizado_em = now()",
                )
                .bind(id)
                .bind(campo)
                .bind(envelope)
                .execute(&mut *tx)
                .await
                .map_err(map_db_err)?;
            }
        }

        tx.commit().await.map_err(map_db_err)?;
        Ok(atualizada)
    }

    async fn definir_habilitado(
        &self,
        id: i64,
        habilitado: bool,
        atualizado_por: Option<i64>,
    ) -> Result<Integracao, DomainError> {
        sqlx::query_as::<_, Integracao>(&format!(
            "UPDATE integracao SET habilitado = $2, atualizado_por = $3,
                atualizado_em = now()
             WHERE id = $1 RETURNING {COLS}"
        ))
        .bind(id)
        .bind(habilitado)
        .bind(atualizado_por)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| DomainError::nao_encontrado("Integração não encontrada."))
    }

    async fn registrar_verificacao(
        &self,
        id: i64,
        versao: i32,
        status: StatusVerificacao,
        erro: Option<&str>,
        nome_conta: Option<&str>,
        capabilities: &serde_json::Value,
    ) -> Result<(), DomainError> {
        // Só grava se a versão testada ainda é a atual — resultado de
        // credencial antiga não valida a nova configuração.
        sqlx::query(
            "UPDATE integracao SET
                ultima_verificacao_em = now(),
                verificacao_status = $2,
                verificacao_erro = $3,
                nome_conta = COALESCE($4, nome_conta),
                capabilities = $5,
                status = CASE
                    WHEN $2 = 'falha' THEN 'falha'
                    WHEN habilitado THEN 'ativa'
                    ELSE 'pendente' END,
                atualizado_em = now()
             WHERE id = $1 AND versao = $6",
        )
        .bind(id)
        .bind(status.as_str())
        .bind(erro)
        .bind(nome_conta)
        .bind(capabilities)
        .bind(versao)
        .execute(&self.pool)
        .await
        .map_err(map_db_err)?;
        Ok(())
    }

    async fn segredos_enc(
        &self,
        idintegracao: i64,
    ) -> Result<HashMap<String, Vec<u8>>, DomainError> {
        let rows: Vec<(String, Vec<u8>)> = sqlx::query_as(
            "SELECT campo, valor_enc FROM integracao_segredo WHERE idintegracao = $1",
        )
        .bind(idintegracao)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)?;
        Ok(rows.into_iter().collect())
    }

    async fn mapa_segredos(&self, idintegracao: i64) -> Result<MapaSegredos, DomainError> {
        let rows: Vec<(String,)> =
            sqlx::query_as("SELECT campo FROM integracao_segredo WHERE idintegracao = $1")
                .bind(idintegracao)
                .fetch_all(&self.pool)
                .await
                .map_err(map_db_err)?;
        Ok(MapaSegredos {
            campos: rows.into_iter().map(|(c,)| (c, true)).collect(),
        })
    }

    async fn remover(&self, id: i64) -> Result<(), DomainError> {
        sqlx::query("DELETE FROM integracao WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(map_db_err)?;
        Ok(())
    }

    async fn padrao(
        &self,
        escopo: &str,
    ) -> Result<Option<(ProvedorPagamento, AmbienteIntegracao, i64)>, DomainError> {
        let row: Option<(String, String, i64)> = sqlx::query_as(
            "SELECT i.provedor, i.ambiente, i.id
             FROM integracao_padrao p JOIN integracao i ON i.id = p.idintegracao
             WHERE p.escopo = $1",
        )
        .bind(escopo)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)?;
        Ok(row.and_then(|(p, a, id)| {
            Some((
                ProvedorPagamento::parse(&p)?,
                AmbienteIntegracao::parse(&a)?,
                id,
            ))
        }))
    }

    async fn definir_padrao(
        &self,
        escopo: &str,
        idintegracao: i64,
        atualizado_por: Option<i64>,
    ) -> Result<(), DomainError> {
        sqlx::query(
            "INSERT INTO integracao_padrao (escopo, idintegracao, atualizado_por)
             VALUES ($1, $2, $3)
             ON CONFLICT (escopo) DO UPDATE SET idintegracao = EXCLUDED.idintegracao,
                 atualizado_por = EXCLUDED.atualizado_por, atualizado_em = now()",
        )
        .bind(escopo)
        .bind(idintegracao)
        .bind(atualizado_por)
        .execute(&self.pool)
        .await
        .map_err(map_db_err)?;
        Ok(())
    }

    async fn limpar_padrao_se(&self, idintegracao: i64) -> Result<(), DomainError> {
        sqlx::query("DELETE FROM integracao_padrao WHERE idintegracao = $1")
            .bind(idintegracao)
            .execute(&self.pool)
            .await
            .map_err(map_db_err)?;
        Ok(())
    }
}
