//! Impressoras de rede por setor — CRUD + resolução de roteamento KOT.

use super::audit;
use crate::db::map_db_err;
use async_trait::async_trait;
use clarituz_domain::entities::{Impressora, NovoLog};
use clarituz_domain::ports::{DadosImpressora, ImpressoraRepository, ItemProducao};
use clarituz_domain::DomainError;
use sqlx::PgPool;

#[derive(Clone)]
pub struct PgImpressoraRepository {
    pool: PgPool,
}
impl PgImpressoraRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl ImpressoraRepository for PgImpressoraRepository {
    async fn listar(&self) -> Result<Vec<Impressora>, DomainError> {
        sqlx::query_as::<_, Impressora>(
            "SELECT id, nome, setor, ip, porta, ativa, padrao, version, criado_em
             FROM impressora ORDER BY setor, nome",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn por_id(&self, id: i64) -> Result<Option<Impressora>, DomainError> {
        sqlx::query_as::<_, Impressora>(
            "SELECT id, nome, setor, ip, porta, ativa, padrao, version, criado_em
             FROM impressora WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn padrao(&self) -> Result<Option<Impressora>, DomainError> {
        sqlx::query_as::<_, Impressora>(
            "SELECT id, nome, setor, ip, porta, ativa, padrao, version, criado_em
             FROM impressora WHERE padrao AND ativa",
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn criar(&self, d: &DadosImpressora, log: NovoLog) -> Result<Impressora, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        if d.padrao {
            // única padrão: desmarca as demais na mesma transação
            sqlx::query("UPDATE impressora SET padrao = FALSE WHERE padrao")
                .execute(&mut *tx)
                .await
                .map_err(map_db_err)?;
        }
        let imp = sqlx::query_as::<_, Impressora>(
            "INSERT INTO impressora (nome, setor, ip, porta, ativa, padrao)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, nome, setor, ip, porta, ativa, padrao, version, criado_em",
        )
        .bind(&d.nome)
        .bind(&d.setor)
        .bind(&d.ip)
        .bind(d.porta)
        .bind(d.ativa)
        .bind(d.padrao)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;
        let mut log = log;
        log.idtabela = imp.id;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(imp)
    }

    async fn atualizar(
        &self,
        id: i64,
        d: &DadosImpressora,
        log: NovoLog,
    ) -> Result<Impressora, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        if d.padrao {
            sqlx::query("UPDATE impressora SET padrao = FALSE WHERE padrao AND id <> $1")
                .bind(id)
                .execute(&mut *tx)
                .await
                .map_err(map_db_err)?;
        }
        let imp = sqlx::query_as::<_, Impressora>(
            "UPDATE impressora SET
                nome = $2, setor = $3, ip = $4, porta = $5, ativa = $6, padrao = $7
             WHERE id = $1 AND ($8::bigint IS NULL OR version = $8)
             RETURNING id, nome, setor, ip, porta, ativa, padrao, version, criado_em",
        )
        .bind(id)
        .bind(&d.nome)
        .bind(&d.setor)
        .bind(&d.ip)
        .bind(d.porta)
        .bind(d.ativa)
        .bind(d.padrao)
        .bind(d.version)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| {
            DomainError::conflito(
                "Impressora alterada por outro usuário. Recarregue e tente novamente.",
            )
        })?;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(imp)
    }

    async fn definir_ativa(&self, id: i64, ativa: bool, log: NovoLog) -> Result<(), DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let n = sqlx::query("UPDATE impressora SET ativa = $2 WHERE id = $1")
            .bind(id)
            .bind(ativa)
            .execute(&mut *tx)
            .await
            .map_err(map_db_err)?
            .rows_affected();
        if n == 0 {
            return Err(DomainError::nao_encontrado("Impressora não encontrada."));
        }
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(())
    }

    async fn remover(&self, id: i64, log: NovoLog) -> Result<(), DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let n = sqlx::query("DELETE FROM impressora WHERE id = $1")
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(map_db_err)?
            .rows_affected();
        if n == 0 {
            return Err(DomainError::nao_encontrado("Impressora não encontrada."));
        }
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(())
    }

    async fn itens_producao(&self, idconsumo: i64) -> Result<Vec<ItemProducao>, DomainError> {
        // item_consumido → estoque → categoria → impressora do setor
        let rows = sqlx::query_as::<
            _,
            (
                String,
                i32,
                Option<i64>,
                Option<String>,
                Option<String>,
                Option<String>,
                Option<i32>,
                Option<bool>,
                Option<bool>,
            ),
        >(
            "SELECT ic.nome, ic.quantidade,
                    imp.id, imp.nome, imp.setor, imp.ip, imp.porta, imp.ativa, imp.padrao
             FROM item_consumido ic
             JOIN estoque e ON e.id = ic.iditem
             LEFT JOIN categoria_estoque c ON c.id = e.idcategoria
             LEFT JOIN impressora imp ON imp.id = c.impressora_id AND imp.ativa
             WHERE ic.idconsumo = $1
             ORDER BY imp.setor NULLS LAST, ic.nome",
        )
        .bind(idconsumo)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)?;

        Ok(rows
            .into_iter()
            .map(
                |(nome, qtd, id, inome, setor, ip, porta, ativa, padrao)| ItemProducao {
                    nome,
                    quantidade: qtd,
                    impressora: id.map(|id| Impressora {
                        id,
                        nome: inome.unwrap_or_default(),
                        setor: setor.unwrap_or_default(),
                        ip: ip.unwrap_or_default(),
                        porta: porta.unwrap_or(9100),
                        ativa: ativa.unwrap_or(true),
                        padrao: padrao.unwrap_or(false),
                        version: 0,
                        criado_em: chrono::Utc::now(),
                    }),
                },
            )
            .collect())
    }

    async fn por_item_estoque(&self, iditem: i64) -> Result<Option<Impressora>, DomainError> {
        sqlx::query_as::<_, Impressora>(
            "SELECT imp.id, imp.nome, imp.setor, imp.ip, imp.porta, imp.ativa,
                    imp.padrao, imp.version, imp.criado_em
             FROM estoque e
             JOIN categoria_estoque c ON c.id = e.idcategoria
             JOIN impressora imp ON imp.id = c.impressora_id AND imp.ativa
             WHERE e.id = $1",
        )
        .bind(iditem)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)
    }
}
