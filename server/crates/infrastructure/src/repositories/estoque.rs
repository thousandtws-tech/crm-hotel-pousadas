//! Estoque: categorias, itens e ledger de movimentações.

use super::audit;
use crate::db::map_db_err;
use async_trait::async_trait;
use clarituz_domain::entities::{CategoriaEstoque, ItemEstoque, NovoLog};
use clarituz_domain::enums::TipoMovimento;
use clarituz_domain::ports::{AtualizaItem, EstoqueRepository, Movimentacao, NovoItem};
use clarituz_domain::queries::MovimentoView;
use clarituz_domain::DomainError;
use clarituz_shared::{Page, PageParams};
use sqlx::PgPool;

#[derive(Clone)]
pub struct PgEstoqueRepository {
    pool: PgPool,
}
impl PgEstoqueRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

const ITEM_COLS: &str =
    "id, nome, idcategoria, quantidade, valor_unitario, ativo, version, criado_em, atualizado_em";

#[async_trait]
impl EstoqueRepository for PgEstoqueRepository {
    async fn listar_categorias(
        &self,
        apenas_ativas: bool,
    ) -> Result<Vec<CategoriaEstoque>, DomainError> {
        sqlx::query_as::<_, CategoriaEstoque>(
            "SELECT id, nome, impressora_id, ativo, version, criado_em FROM categoria_estoque
             WHERE ($1::bool = false OR ativo) ORDER BY nome",
        )
        .bind(apenas_ativas)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn criar_categoria(
        &self,
        nome: &str,
        log: NovoLog,
    ) -> Result<CategoriaEstoque, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let c = sqlx::query_as::<_, CategoriaEstoque>(
            "INSERT INTO categoria_estoque (nome) VALUES ($1)
             RETURNING id, nome, impressora_id, ativo, version, criado_em",
        )
        .bind(nome)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;
        let mut log = log;
        log.idtabela = c.id;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(c)
    }

    async fn definir_categoria_ativa(
        &self,
        id: i64,
        ativo: bool,
        log: NovoLog,
    ) -> Result<CategoriaEstoque, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let c = sqlx::query_as::<_, CategoriaEstoque>(
            "UPDATE categoria_estoque SET ativo = $2 WHERE id = $1
             RETURNING id, nome, impressora_id, ativo, version, criado_em",
        )
        .bind(id)
        .bind(ativo)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| DomainError::nao_encontrado("Categoria não encontrada."))?;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(c)
    }

    async fn definir_impressora_categoria(
        &self,
        id: i64,
        impressora_id: Option<i64>,
        log: NovoLog,
    ) -> Result<CategoriaEstoque, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let c = sqlx::query_as::<_, CategoriaEstoque>(
            "UPDATE categoria_estoque SET impressora_id = $2 WHERE id = $1
             RETURNING id, nome, impressora_id, ativo, version, criado_em",
        )
        .bind(id)
        .bind(impressora_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| DomainError::nao_encontrado("Categoria não encontrada."))?;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(c)
    }

    async fn buscar_item(&self, id: i64) -> Result<Option<ItemEstoque>, DomainError> {
        sqlx::query_as::<_, ItemEstoque>(&format!("SELECT {ITEM_COLS} FROM estoque WHERE id = $1"))
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map_err(map_db_err)
    }

    async fn listar_itens(
        &self,
        apenas_ativos: bool,
        page: PageParams,
    ) -> Result<Page<ItemEstoque>, DomainError> {
        let where_ = "WHERE ($1::bool = false OR ativo)";
        let total = sqlx::query_scalar::<_, i64>(&format!("SELECT COUNT(*) FROM estoque {where_}"))
            .bind(apenas_ativos)
            .fetch_one(&self.pool)
            .await
            .map_err(map_db_err)?;

        let items = sqlx::query_as::<_, ItemEstoque>(&format!(
            "SELECT {ITEM_COLS} FROM estoque {where_} ORDER BY nome LIMIT $2 OFFSET $3"
        ))
        .bind(apenas_ativos)
        .bind(page.limit())
        .bind(page.offset())
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)?;

        Ok(Page::new(items, page, total))
    }

    async fn criar_item(
        &self,
        novo: &NovoItem,
        idfuncionario: i64,
        log: NovoLog,
    ) -> Result<ItemEstoque, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;

        let item = sqlx::query_as::<_, ItemEstoque>(&format!(
            "INSERT INTO estoque (nome, idcategoria, quantidade, valor_unitario)
             VALUES ($1, $2, $3, $4) RETURNING {ITEM_COLS}"
        ))
        .bind(&novo.nome)
        .bind(novo.idcategoria)
        .bind(novo.quantidade_inicial)
        .bind(novo.valor_unitario)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;

        // saldo inicial entra no ledger como 'entrada' — rastreável
        if novo.quantidade_inicial > 0 {
            sqlx::query(
                "INSERT INTO movimento_estoque (iditem, tipo, quantidade, idfuncionario, motivo)
                 VALUES ($1, 'entrada', $2, $3, 'saldo inicial')",
            )
            .bind(item.id)
            .bind(novo.quantidade_inicial)
            .bind(idfuncionario)
            .execute(&mut *tx)
            .await
            .map_err(map_db_err)?;
        }

        let mut log = log;
        log.idtabela = item.id;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(item)
    }

    async fn atualizar_item(
        &self,
        id: i64,
        d: &AtualizaItem,
        log: NovoLog,
    ) -> Result<ItemEstoque, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let item = sqlx::query_as::<_, ItemEstoque>(&format!(
            "UPDATE estoque SET
                nome = COALESCE($2, nome),
                idcategoria = COALESCE($3, idcategoria),
                valor_unitario = COALESCE($4, valor_unitario),
                atualizado_em = now()
             WHERE id = $1 AND ($5::bigint IS NULL OR version = $5)
             RETURNING {ITEM_COLS}"
        ))
        .bind(id)
        .bind(&d.nome)
        .bind(d.idcategoria)
        .bind(d.valor_unitario)
        .bind(d.version)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| {
            DomainError::conflito(
                "Item de estoque alterado por outro usuário. Recarregue e tente novamente.",
            )
        })?;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(item)
    }

    async fn definir_item_ativo(
        &self,
        id: i64,
        ativo: bool,
        log: NovoLog,
    ) -> Result<ItemEstoque, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let item = sqlx::query_as::<_, ItemEstoque>(&format!(
            "UPDATE estoque SET ativo = $2, atualizado_em = now()
             WHERE id = $1 RETURNING {ITEM_COLS}"
        ))
        .bind(id)
        .bind(ativo)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| DomainError::nao_encontrado("Item não encontrado."))?;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(item)
    }

    /// Lote atômico: qualquer falha desfaz **todas** as movimentações —
    /// o estoque nunca fica meio-atualizado.
    async fn movimentar(
        &self,
        movimentos: &[Movimentacao],
        idfuncionario: i64,
        log: NovoLog,
    ) -> Result<u64, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let mut aplicadas = 0u64;

        for m in movimentos {
            // FOR UPDATE serializa movimentos concorrentes do mesmo item
            let saldo = sqlx::query_scalar::<_, i32>(
                "SELECT quantidade FROM estoque WHERE id = $1 AND ativo FOR UPDATE",
            )
            .bind(m.iditem)
            .fetch_optional(&mut *tx)
            .await
            .map_err(map_db_err)?
            .ok_or_else(|| {
                DomainError::nao_encontrado(format!("Item {} não encontrado.", m.iditem))
            })?;

            let delta = match m.tipo {
                TipoMovimento::Entrada => m.quantidade,
                TipoMovimento::Saida => -m.quantidade,
            };
            let novo_saldo = saldo + delta;
            if novo_saldo < 0 {
                return Err(DomainError::regra(format!(
                    "Saldo insuficiente do item {} (saldo {}, saída {}).",
                    m.iditem, saldo, m.quantidade
                )));
            }

            sqlx::query("UPDATE estoque SET quantidade = $2, atualizado_em = now() WHERE id = $1")
                .bind(m.iditem)
                .bind(novo_saldo)
                .execute(&mut *tx)
                .await
                .map_err(map_db_err)?;

            sqlx::query(
                "INSERT INTO movimento_estoque (iditem, tipo, quantidade, idfuncionario, motivo)
                 VALUES ($1, $2, $3, $4, $5)",
            )
            .bind(m.iditem)
            .bind(m.tipo)
            .bind(m.quantidade)
            .bind(idfuncionario)
            .bind(&m.motivo)
            .execute(&mut *tx)
            .await
            .map_err(map_db_err)?;

            aplicadas += 1;
        }

        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(aplicadas)
    }

    async fn listar_movimentos(
        &self,
        iditem: Option<i64>,
        page: PageParams,
    ) -> Result<Page<MovimentoView>, DomainError> {
        let where_ = "WHERE ($1::bigint IS NULL OR m.iditem = $1)";

        let total = sqlx::query_scalar::<_, i64>(&format!(
            "SELECT COUNT(*) FROM movimento_estoque m {where_}"
        ))
        .bind(iditem)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)?;

        let items = sqlx::query_as::<_, MovimentoView>(&format!(
            "SELECT m.id, m.iditem, e.nome AS item_nome, m.tipo, m.quantidade,
                    f.nome AS funcionario, m.motivo, m.criado_em
             FROM movimento_estoque m
             JOIN estoque e ON e.id = m.iditem
             LEFT JOIN funcionario f ON f.id = m.idfuncionario
             {where_} ORDER BY m.id DESC LIMIT $2 OFFSET $3"
        ))
        .bind(iditem)
        .bind(page.limit())
        .bind(page.offset())
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)?;

        Ok(Page::new(items, page, total))
    }
}
