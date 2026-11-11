//! Impressoras de rede por setor — CRUD + resolução de roteamento KOT.

use super::audit;
use crate::persistence::db::map_db_err;
use async_trait::async_trait;
use clarituz_domain::entities::{ImpressaoJob, Impressora, ImpressoraDescoberta, NovoLog};
use clarituz_domain::ports::{DadosImpressora, ImpressoraRepository, ItemProducao, NovaDescoberta};
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
            "SELECT id, nome, setor, ip, porta, ativa, padrao, etiqueta, version, criado_em
             FROM impressora ORDER BY setor, nome",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn por_id(&self, id: i64) -> Result<Option<Impressora>, DomainError> {
        sqlx::query_as::<_, Impressora>(
            "SELECT id, nome, setor, ip, porta, ativa, padrao, etiqueta, version, criado_em
             FROM impressora WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn padrao(&self) -> Result<Option<Impressora>, DomainError> {
        sqlx::query_as::<_, Impressora>(
            "SELECT id, nome, setor, ip, porta, ativa, padrao, etiqueta, version, criado_em
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
            "INSERT INTO impressora (nome, setor, ip, porta, ativa, padrao, etiqueta)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id, nome, setor, ip, porta, ativa, padrao, etiqueta, version, criado_em",
        )
        .bind(&d.nome)
        .bind(&d.setor)
        .bind(&d.ip)
        .bind(d.porta)
        .bind(d.ativa)
        .bind(d.padrao)
        .bind(d.etiqueta)
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
        if d.etiqueta {
            sqlx::query("UPDATE impressora SET etiqueta = FALSE WHERE etiqueta AND id <> $1")
                .bind(id)
                .execute(&mut *tx)
                .await
                .map_err(map_db_err)?;
        }
        let imp = sqlx::query_as::<_, Impressora>(
            "UPDATE impressora SET
                nome = $2, setor = $3, ip = $4, porta = $5, ativa = $6,
                padrao = $7, etiqueta = $8
             WHERE id = $1 AND ($9::bigint IS NULL OR version = $9)
             RETURNING id, nome, setor, ip, porta, ativa, padrao, etiqueta, version, criado_em",
        )
        .bind(id)
        .bind(&d.nome)
        .bind(&d.setor)
        .bind(&d.ip)
        .bind(d.porta)
        .bind(d.ativa)
        .bind(d.padrao)
        .bind(d.etiqueta)
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

    async fn registrar_descobertas(&self, itens: &[NovaDescoberta]) -> Result<usize, DomainError> {
        // upsert por (tipo,endereco,porta) — re-reportar só atualiza metadados
        // e reabre o que foi ignorado como pendente.
        let mut n = 0usize;
        for d in itens {
            sqlx::query(
                "INSERT INTO impressora_descoberta (tipo, endereco, porta, modelo, origem)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (tipo, endereco, COALESCE(porta, 0))
                 DO UPDATE SET visto_em = now(), modelo = EXCLUDED.modelo,
                               origem = EXCLUDED.origem,
                               status = CASE WHEN impressora_descoberta.status = 'ignorada'
                                             THEN 'pendente' ELSE impressora_descoberta.status END,
                               resolvido_em = CASE WHEN impressora_descoberta.status = 'ignorada'
                                             THEN NULL ELSE impressora_descoberta.resolvido_em END",
            )
            .bind(&d.tipo)
            .bind(&d.endereco)
            .bind(d.porta)
            .bind(&d.modelo)
            .bind(&d.origem)
            .execute(&self.pool)
            .await
            .map_err(map_db_err)?;
            n += 1;
        }
        Ok(n)
    }

    async fn listar_descobertas(&self) -> Result<Vec<ImpressoraDescoberta>, DomainError> {
        sqlx::query_as::<_, ImpressoraDescoberta>(
            "SELECT id, tipo, endereco, porta, modelo, origem, status, impressora_id, visto_em
             FROM impressora_descoberta
             WHERE status = 'pendente'
             ORDER BY visto_em DESC",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn registrar_impressora_da_descoberta(
        &self,
        descoberta_id: i64,
        d: &DadosImpressora,
        log: NovoLog,
    ) -> Result<Impressora, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let desc = sqlx::query_as::<_, ImpressoraDescoberta>(
            "SELECT id, tipo, endereco, porta, modelo, origem, status, impressora_id, visto_em
             FROM impressora_descoberta WHERE id = $1 FOR UPDATE",
        )
        .bind(descoberta_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| DomainError::nao_encontrado("Descoberta não encontrada."))?;
        if desc.status == "registrada" {
            return Err(DomainError::regra("Descoberta já foi registrada."));
        }
        // o endereço real vem da descoberta — usb registra como "usb:<fila>"
        let (ip, porta) = if desc.tipo == "usb" {
            (format!("usb:{}", desc.endereco), 0i32)
        } else {
            (desc.endereco.clone(), desc.porta.unwrap_or(9100))
        };
        if d.padrao {
            sqlx::query("UPDATE impressora SET padrao = FALSE WHERE padrao")
                .execute(&mut *tx)
                .await
                .map_err(map_db_err)?;
        }
        if d.etiqueta {
            sqlx::query("UPDATE impressora SET etiqueta = FALSE WHERE etiqueta")
                .execute(&mut *tx)
                .await
                .map_err(map_db_err)?;
        }
        let imp = sqlx::query_as::<_, Impressora>(
            "INSERT INTO impressora (nome, setor, ip, porta, ativa, padrao, etiqueta)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id, nome, setor, ip, porta, ativa, padrao, etiqueta, version, criado_em",
        )
        .bind(&d.nome)
        .bind(&d.setor)
        .bind(&ip)
        .bind(porta)
        .bind(d.ativa)
        .bind(d.padrao)
        .bind(d.etiqueta)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;
        sqlx::query(
            "UPDATE impressora_descoberta
             SET status = 'registrada', impressora_id = $2, resolvido_em = now()
             WHERE id = $1",
        )
        .bind(descoberta_id)
        .bind(imp.id)
        .execute(&mut *tx)
        .await
        .map_err(map_db_err)?;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(imp)
    }

    async fn ignorar_descoberta(&self, id: i64) -> Result<(), DomainError> {
        let n = sqlx::query(
            "UPDATE impressora_descoberta
             SET status = 'ignorada', resolvido_em = now()
             WHERE id = $1 AND status = 'pendente'",
        )
        .bind(id)
        .execute(&self.pool)
        .await
        .map_err(map_db_err)?
        .rows_affected();
        if n == 0 {
            return Err(DomainError::nao_encontrado(
                "Descoberta não encontrada ou já resolvida.",
            ));
        }
        Ok(())
    }

    async fn jobs_pendentes(&self) -> Result<Vec<ImpressaoJob>, DomainError> {
        sqlx::query_as::<_, ImpressaoJob>(
            "SELECT id, impressora_id, host, porta, payload, modo, status, tentativas, erro, criado_em
             FROM impressao_job WHERE status = 'pendente' ORDER BY id LIMIT 50",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn resultado_job(
        &self,
        id: i64,
        sucesso: bool,
        erro: Option<&str>,
    ) -> Result<(), DomainError> {
        let n = if sucesso {
            sqlx::query(
                "UPDATE impressao_job SET status = 'impresso', impresso_em = now()
                 WHERE id = $1 AND status = 'pendente'",
            )
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(map_db_err)?
            .rows_affected()
        } else {
            sqlx::query(
                "UPDATE impressao_job
                 SET tentativas = tentativas + 1, erro = $2,
                     status = CASE WHEN tentativas + 1 >= 3 THEN 'erro' ELSE 'pendente' END
                 WHERE id = $1 AND status = 'pendente'",
            )
            .bind(id)
            .bind(erro)
            .execute(&self.pool)
            .await
            .map_err(map_db_err)?
            .rows_affected()
        };
        if n == 0 {
            return Err(DomainError::nao_encontrado(
                "Job não encontrado ou já resolvido.",
            ));
        }
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
                        etiqueta: false,
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
