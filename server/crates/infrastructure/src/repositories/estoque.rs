//! Estoque: categorias, itens e ledger de movimentações.

use super::audit;
use crate::db::{map_db_err, map_del_err};
use async_trait::async_trait;
use clarituz_domain::entities::{
    CategoriaEstoque, ConversaoUnidade, FichaTecnica, ItemEstoque, NfeImport, NovoLog,
};
use clarituz_domain::enums::TipoMovimento;
use clarituz_domain::ports::{
    AtualizaItem, EstoqueRepository, Movimentacao, NfeItemConfirmado, NfeRegistro, NovoItem,
};
use clarituz_domain::queries::{EstoqueBaixoView, FichaItemView, MovimentoView};
use clarituz_domain::DomainError;
use clarituz_shared::{Page, PageParams};
use rust_decimal::Decimal;
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
    "id, nome, idcategoria, quantidade, valor_unitario, unidade, estoque_minimo, eh_insumo, ativo, version, criado_em, atualizado_em";

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

    async fn remover_categoria(&self, id: i64, log: NovoLog) -> Result<(), DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let r = sqlx::query("DELETE FROM categoria_estoque WHERE id = $1")
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(|e| {
                map_del_err(e, "Categoria possui itens vinculados — exclua-os primeiro.")
            })?;
        if r.rows_affected() == 0 {
            return Err(DomainError::nao_encontrado("Categoria não encontrada."));
        }
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(())
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
            "INSERT INTO estoque (nome, idcategoria, quantidade, valor_unitario, unidade, estoque_minimo, eh_insumo)
             VALUES ($1, $2, $3, $4, COALESCE($5, 'un'), COALESCE($6, 0), $7) RETURNING {ITEM_COLS}"
        ))
        .bind(&novo.nome)
        .bind(novo.idcategoria)
        .bind(novo.quantidade_inicial)
        .bind(novo.valor_unitario)
        .bind(&novo.unidade)
        .bind(novo.estoque_minimo)
        .bind(novo.eh_insumo)
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
                unidade = COALESCE($5, unidade),
                estoque_minimo = COALESCE($6, estoque_minimo),
                eh_insumo = COALESCE($7, eh_insumo),
                atualizado_em = now()
             WHERE id = $1 AND ($8::bigint IS NULL OR version = $8)
             RETURNING {ITEM_COLS}"
        ))
        .bind(id)
        .bind(&d.nome)
        .bind(d.idcategoria)
        .bind(d.valor_unitario)
        .bind(&d.unidade)
        .bind(d.estoque_minimo)
        .bind(d.eh_insumo)
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

    async fn remover_item(&self, id: i64, log: NovoLog) -> Result<(), DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        // dependentes sem cascade: ledger do item e vínculos em frigobares
        sqlx::query("DELETE FROM movimento_estoque WHERE iditem = $1")
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(map_db_err)?;
        sqlx::query("DELETE FROM item_frigobar WHERE iditem = $1")
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(map_db_err)?;
        let r = sqlx::query("DELETE FROM estoque WHERE id = $1")
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(|e| {
                map_del_err(
                    e,
                    "Item já consumido em reservas — inative-o em vez de excluir.",
                )
            })?;
        if r.rows_affected() == 0 {
            return Err(DomainError::nao_encontrado("Item não encontrado."));
        }
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(())
    }

    // -- ficha tecnica --------------------------------------------------------

    async fn listar_ficha(&self, idproduto: i64) -> Result<Vec<FichaItemView>, DomainError> {
        sqlx::query_as::<_, FichaItemView>(
            "SELECT f.id, f.idinsumo, i.nome AS insumo, i.unidade,
                    f.quantidade, i.valor_unitario AS custo_unit
             FROM ficha_tecnica f
             JOIN estoque i ON i.id = f.idinsumo
             WHERE f.idproduto = $1
             ORDER BY i.nome",
        )
        .bind(idproduto)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn salvar_ficha_item(
        &self,
        idproduto: i64,
        idinsumo: i64,
        quantidade: i32,
        log: NovoLog,
    ) -> Result<FichaTecnica, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let row = sqlx::query_as::<_, FichaTecnica>(
            "INSERT INTO ficha_tecnica (idproduto, idinsumo, quantidade)
             VALUES ($1, $2, $3)
             ON CONFLICT (idproduto, idinsumo) DO UPDATE SET quantidade = $3
             RETURNING id, idproduto, idinsumo, quantidade, criado_em",
        )
        .bind(idproduto)
        .bind(idinsumo)
        .bind(quantidade)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(row)
    }

    async fn remover_ficha_item(&self, idficha: i64, log: NovoLog) -> Result<(), DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let r = sqlx::query("DELETE FROM ficha_tecnica WHERE id = $1")
            .bind(idficha)
            .execute(&mut *tx)
            .await
            .map_err(map_db_err)?;
        if r.rows_affected() == 0 {
            return Err(DomainError::nao_encontrado("Item da ficha nao encontrado."));
        }
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(())
    }

    // -- conversoes de unidade ------------------------------------------------

    async fn listar_conversoes(&self, iditem: i64) -> Result<Vec<ConversaoUnidade>, DomainError> {
        sqlx::query_as::<_, ConversaoUnidade>(
            "SELECT id, iditem, unidade_compra, fator, criado_em
             FROM estoque_conversao WHERE iditem = $1 ORDER BY unidade_compra",
        )
        .bind(iditem)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn salvar_conversao(
        &self,
        iditem: i64,
        unidade_compra: &str,
        fator: i32,
        log: NovoLog,
    ) -> Result<ConversaoUnidade, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let row = sqlx::query_as::<_, ConversaoUnidade>(
            "INSERT INTO estoque_conversao (iditem, unidade_compra, fator)
             VALUES ($1, $2, $3)
             ON CONFLICT (iditem, unidade_compra) DO UPDATE SET fator = $3
             RETURNING id, iditem, unidade_compra, fator, criado_em",
        )
        .bind(iditem)
        .bind(unidade_compra)
        .bind(fator)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(row)
    }

    async fn remover_conversao(&self, id: i64, log: NovoLog) -> Result<(), DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let r = sqlx::query("DELETE FROM estoque_conversao WHERE id = $1")
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(map_db_err)?;
        if r.rows_affected() == 0 {
            return Err(DomainError::nao_encontrado("Conversao nao encontrada."));
        }
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(())
    }

    // -- alertas ---------------------------------------------------------------

    async fn alertas_minimo(&self) -> Result<Vec<EstoqueBaixoView>, DomainError> {
        sqlx::query_as::<_, EstoqueBaixoView>(
            "SELECT id, nome, unidade, quantidade, estoque_minimo
             FROM estoque
             WHERE ativo AND estoque_minimo > 0 AND quantidade <= estoque_minimo
             ORDER BY quantidade - estoque_minimo, nome",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    // -- NF-e -------------------------------------------------------------------

    async fn nfe_ja_importada(&self, chave: &str) -> Result<bool, DomainError> {
        let n: i64 = sqlx::query_scalar("SELECT count(*) FROM estoque_nfe WHERE chave = $1")
            .bind(chave)
            .fetch_one(&self.pool)
            .await
            .map_err(map_db_err)?;
        Ok(n > 0)
    }

    async fn registrar_nfe(
        &self,
        nfe: &NfeRegistro,
        itens: &[NfeItemConfirmado],
        idfuncionario: i64,
        log: NovoLog,
    ) -> Result<NfeImport, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;

        let idlancamento: Option<i64> = if nfe.gerar_pagamento {
            let descricao = format!(
                "NF-e {} - {}",
                nfe.numero.as_deref().unwrap_or("s/n"),
                nfe.emitente.as_deref().unwrap_or("fornecedor")
            );
            Some(
                sqlx::query_scalar::<_, i64>(
                    "INSERT INTO lancamento
                         (tipo, descricao, idplano_conta, favorecido, documento,
                          valor, emissao, vencimento, competencia, status,
                          observacao, idfuncionario)
                     VALUES ('pagar', $1,
                             (SELECT id FROM plano_conta WHERE codigo = '3.04'),
                             $2, $3, $4,
                             COALESCE($5, CURRENT_DATE), $6, $6, 'aberto',
                             $7, $8)
                     RETURNING id",
                )
                .bind(&descricao)
                .bind(&nfe.emitente)
                .bind(&nfe.cnpj)
                .bind(nfe.total)
                .bind(nfe.emissao)
                .bind(nfe.vencimento)
                .bind(format!("NF-e importada - chave {}", nfe.chave))
                .bind(idfuncionario)
                .fetch_one(&mut *tx)
                .await
                .map_err(map_db_err)?,
            )
        } else {
            None
        };

        let nfe_row = sqlx::query_as::<_, NfeImport>(
            "INSERT INTO estoque_nfe
                 (chave, numero, emitente, cnpj, emissao, total, idlancamento, importado_por)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id, chave, numero, emitente, cnpj, emissao, total,
                       idlancamento, importado_por, criado_em",
        )
        .bind(&nfe.chave)
        .bind(&nfe.numero)
        .bind(&nfe.emitente)
        .bind(&nfe.cnpj)
        .bind(nfe.emissao)
        .bind(nfe.total)
        .bind(idlancamento)
        .bind(idfuncionario)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;

        for it in itens {
            let iditem = if let Some(id) = it.iditem {
                id
            } else {
                let custo = if it.quantidade_base > 0 {
                    (it.valor_total / Decimal::from(it.quantidade_base)).round_dp(2)
                } else {
                    Decimal::ZERO
                };
                sqlx::query_scalar::<_, i64>(
                    "INSERT INTO estoque (nome, unidade, quantidade, valor_unitario, eh_insumo)
                         VALUES ($1, 'un', 0, $2, TRUE)
                         ON CONFLICT (nome) WHERE ativo DO NOTHING
                         RETURNING id",
                )
                .bind(&it.nome)
                .bind(custo)
                .fetch_optional(&mut *tx)
                .await
                .map_err(map_db_err)?
                .or(sqlx::query_scalar::<_, i64>(
                    "SELECT id FROM estoque WHERE nome = $1 AND ativo",
                )
                .bind(&it.nome)
                .fetch_optional(&mut *tx)
                .await
                .map_err(map_db_err)?)
                .ok_or_else(|| {
                    DomainError::regra(format!("Nao foi possivel criar o item '{}'.", it.nome))
                })?
            };

            if it.fator != 1 {
                sqlx::query(
                    "INSERT INTO estoque_conversao (iditem, unidade_compra, fator)
                     VALUES ($1, $2, $3)
                     ON CONFLICT (iditem, unidade_compra) DO UPDATE SET fator = $3",
                )
                .bind(iditem)
                .bind(&it.unidade_compra)
                .bind(it.fator)
                .execute(&mut *tx)
                .await
                .map_err(map_db_err)?;
            }

            sqlx::query(
                "UPDATE estoque SET quantidade = quantidade + $2, atualizado_em = now()
                 WHERE id = $1",
            )
            .bind(iditem)
            .bind(it.quantidade_base)
            .execute(&mut *tx)
            .await
            .map_err(map_db_err)?;

            sqlx::query(
                "INSERT INTO movimento_estoque (iditem, tipo, quantidade, idfuncionario, motivo)
                 VALUES ($1, 'entrada', $2, $3, $4)",
            )
            .bind(iditem)
            .bind(it.quantidade_base)
            .bind(idfuncionario)
            .bind(format!(
                "NF-e {} - {} {}",
                nfe.numero.as_deref().unwrap_or("s/n"),
                it.quantidade.normalize(),
                it.unidade_compra
            ))
            .execute(&mut *tx)
            .await
            .map_err(map_db_err)?;
        }

        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(nfe_row)
    }
}
