//! Compras: fornecedores e pedidos de compra.
//! `criar_pedido` gera a conta a pagar na mesma transação;
//! `receber_pedido` dá entrada no estoque com anti-duplicação
//! (`CHECK quantidade_recebida <= quantidade` + validação por linha).

use super::audit;
use crate::db::{map_db_err, map_del_err};
use async_trait::async_trait;
use clarituz_domain::entities::{Fornecedor, NovoLog, PedidoCompra, PedidoCompraItem};
use clarituz_domain::ports::{
    ComprasRepository, NovoFornecedor, NovoPedido, NovoPedidoItem, RecebimentoItem,
};
use clarituz_domain::queries::{PedidoCompraView, PedidoItemView};
use clarituz_domain::DomainError;
use clarituz_shared::{Page, PageParams};
use sqlx::PgPool;

#[derive(Clone)]
pub struct PgComprasRepository {
    pool: PgPool,
}

impl PgComprasRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

const FORN_COLS: &str =
    "id, nome, cnpj, contato, telefone, lead_time_dias, ativo, criado_em, atualizado_em";
const PED_COLS: &str = "id, idfornecedor, data_prevista, valor_total, status, origem,
     idlancamento, criado_por, observacao, criado_em, atualizado_em";

#[async_trait]
impl ComprasRepository for PgComprasRepository {
    // -- fornecedores ---------------------------------------------------------

    async fn listar_fornecedores(
        &self,
        apenas_ativos: bool,
    ) -> Result<Vec<Fornecedor>, DomainError> {
        sqlx::query_as::<_, Fornecedor>(&format!(
            "SELECT {FORN_COLS} FROM fornecedor
             WHERE ($1 = false OR ativo) ORDER BY nome"
        ))
        .bind(apenas_ativos)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn buscar_fornecedor(&self, id: i64) -> Result<Option<Fornecedor>, DomainError> {
        sqlx::query_as::<_, Fornecedor>(&format!(
            "SELECT {FORN_COLS} FROM fornecedor WHERE id = $1"
        ))
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn salvar_fornecedor(
        &self,
        novo: &NovoFornecedor,
        log: NovoLog,
    ) -> Result<Fornecedor, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let f = sqlx::query_as::<_, Fornecedor>(&format!(
            "INSERT INTO fornecedor (nome, cnpj, contato, telefone, lead_time_dias)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (nome) WHERE ativo
             DO UPDATE SET cnpj = $2, contato = $3, telefone = $4, lead_time_dias = $5,
                           atualizado_em = now()
             RETURNING {FORN_COLS}"
        ))
        .bind(&novo.nome)
        .bind(&novo.cnpj)
        .bind(&novo.contato)
        .bind(&novo.telefone)
        .bind(novo.lead_time_dias)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(f)
    }

    async fn definir_fornecedor_ativo(
        &self,
        id: i64,
        ativo: bool,
        log: NovoLog,
    ) -> Result<Fornecedor, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let f = sqlx::query_as::<_, Fornecedor>(&format!(
            "UPDATE fornecedor SET ativo = $2, atualizado_em = now()
             WHERE id = $1 RETURNING {FORN_COLS}"
        ))
        .bind(id)
        .bind(ativo)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| DomainError::nao_encontrado("Fornecedor não encontrado."))?;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(f)
    }

    // -- pedidos ----------------------------------------------------------------

    async fn listar_pedidos(
        &self,
        status: Option<&str>,
        page: PageParams,
    ) -> Result<Page<PedidoCompraView>, DomainError> {
        let total: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM pedido_compra WHERE ($1::text IS NULL OR status = $1)",
        )
        .bind(status)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)?;

        let items = sqlx::query_as::<_, PedidoCompraView>(
            "SELECT p.id, p.idfornecedor, f.nome AS fornecedor, f.cnpj AS fornecedor_cnpj,
                    p.data_prevista, p.valor_total, p.status, p.origem, p.idlancamento,
                    fu.nome AS criado_por, p.observacao,
                    COALESCE((SELECT count(*) FROM pedido_compra_item i WHERE i.idpedido = p.id), 0) AS total_itens,
                    COALESCE((SELECT count(*) FROM pedido_compra_item i WHERE i.idpedido = p.id AND i.quantidade_recebida >= i.quantidade), 0) AS recebido_itens,
                    p.criado_em
             FROM pedido_compra p
             JOIN fornecedor f ON f.id = p.idfornecedor
             LEFT JOIN funcionario fu ON fu.id = p.criado_por
             WHERE ($1::text IS NULL OR p.status = $1)
             ORDER BY CASE p.status WHEN 'pendente' THEN 0 WHEN 'parcial' THEN 1 ELSE 2 END,
                      p.data_prevista, p.id DESC
             LIMIT $2 OFFSET $3",
        )
        .bind(status)
        .bind(i64::from(page.per_page))
        .bind(i64::from((page.page - 1) * page.per_page))
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)?;

        Ok(Page::new(items, page, total))
    }

    async fn buscar_pedido(
        &self,
        id: i64,
    ) -> Result<Option<(PedidoCompraView, Vec<PedidoItemView>)>, DomainError> {
        let ped = sqlx::query_as::<_, PedidoCompraView>(
            "SELECT p.id, p.idfornecedor, f.nome AS fornecedor, f.cnpj AS fornecedor_cnpj,
                    p.data_prevista, p.valor_total, p.status, p.origem, p.idlancamento,
                    fu.nome AS criado_por, p.observacao,
                    COALESCE((SELECT count(*) FROM pedido_compra_item i WHERE i.idpedido = p.id), 0) AS total_itens,
                    COALESCE((SELECT count(*) FROM pedido_compra_item i WHERE i.idpedido = p.id AND i.quantidade_recebida >= i.quantidade), 0) AS recebido_itens,
                    p.criado_em
             FROM pedido_compra p
             JOIN fornecedor f ON f.id = p.idfornecedor
             LEFT JOIN funcionario fu ON fu.id = p.criado_por
             WHERE p.id = $1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)?;

        let Some(ped) = ped else { return Ok(None) };

        let itens = sqlx::query_as::<_, PedidoItemView>(
            "SELECT i.id, i.iditem, e.nome AS item, e.unidade,
                    i.quantidade, i.quantidade_recebida, i.valor_unit
             FROM pedido_compra_item i
             JOIN estoque e ON e.id = i.iditem
             WHERE i.idpedido = $1
             ORDER BY e.nome",
        )
        .bind(id)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)?;

        Ok(Some((ped, itens)))
    }

    async fn criar_pedido(
        &self,
        pedido: &NovoPedido,
        itens: &[NovoPedidoItem],
        fornecedor: &Fornecedor,
        idfuncionario: i64,
        log: NovoLog,
    ) -> Result<(PedidoCompra, Vec<PedidoCompraItem>), DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;

        // conta a pagar vinculada ao fornecedor — mesma tx
        let idlancamento: Option<i64> = if pedido.gerar_pagamento {
            Some(
                sqlx::query_scalar::<_, i64>(
                    "INSERT INTO lancamento
                         (tipo, descricao, idplano_conta, favorecido, documento,
                          valor, emissao, vencimento, competencia, status,
                          observacao, idfuncionario)
                     VALUES ('pagar', $1,
                             (SELECT id FROM plano_conta WHERE codigo = '3.04'),
                             $2, $3, $4,
                             CURRENT_DATE, $5, $5, 'aberto',
                             $6, $7)
                     RETURNING id",
                )
                .bind(format!("Pedido de compra — {}", fornecedor.nome))
                .bind(&fornecedor.nome)
                .bind(&fornecedor.cnpj)
                .bind(pedido.valor_total)
                .bind(pedido.vencimento)
                .bind(&pedido.observacao)
                .bind(idfuncionario)
                .fetch_one(&mut *tx)
                .await
                .map_err(map_db_err)?,
            )
        } else {
            None
        };

        let ped = sqlx::query_as::<_, PedidoCompra>(&format!(
            "INSERT INTO pedido_compra
                 (idfornecedor, data_prevista, valor_total, status, origem,
                  idlancamento, criado_por, observacao)
             VALUES ($1, $2, $3, 'pendente', $4, $5, $6, $7)
             RETURNING {PED_COLS}"
        ))
        .bind(pedido.idfornecedor)
        .bind(pedido.data_prevista)
        .bind(pedido.valor_total)
        .bind(&pedido.origem)
        .bind(idlancamento)
        .bind(idfuncionario)
        .bind(&pedido.observacao)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;

        let mut linhas = Vec::with_capacity(itens.len());
        for it in itens {
            let row = sqlx::query_as::<_, PedidoCompraItem>(
                "INSERT INTO pedido_compra_item (idpedido, iditem, quantidade, valor_unit)
                 VALUES ($1, $2, $3, $4)
                 RETURNING id, idpedido, iditem, quantidade, quantidade_recebida, valor_unit",
            )
            .bind(ped.id)
            .bind(it.iditem)
            .bind(it.quantidade)
            .bind(it.valor_unit)
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| map_del_err(e, "Item duplicado no pedido — consolide as quantidades."))?;
            linhas.push(row);
        }

        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok((ped, linhas))
    }

    async fn receber_pedido(
        &self,
        idpedido: i64,
        itens: &[RecebimentoItem],
        idfuncionario: i64,
        log: NovoLog,
    ) -> Result<PedidoCompra, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;

        let status: String =
            sqlx::query_scalar("SELECT status FROM pedido_compra WHERE id = $1 FOR UPDATE")
                .bind(idpedido)
                .fetch_optional(&mut *tx)
                .await
                .map_err(map_db_err)?
                .ok_or_else(|| DomainError::nao_encontrado("Pedido não encontrado."))?;
        if status == "recebido" || status == "cancelado" {
            return Err(DomainError::regra(format!(
                "Pedido {status} — não aceita mais recebimentos."
            )));
        }

        for it in itens {
            // FOR UPDATE na linha do pedido — anti-duplicação transacional
            let linha = sqlx::query_as::<_, (i64, i32, i32, String)>(
                "SELECT i.id, i.quantidade, i.quantidade_recebida, e.nome
                 FROM pedido_compra_item i
                 JOIN estoque e ON e.id = i.iditem
                 WHERE i.idpedido = $1 AND i.iditem = $2
                 FOR UPDATE OF i",
            )
            .bind(idpedido)
            .bind(it.iditem)
            .fetch_optional(&mut *tx)
            .await
            .map_err(map_db_err)?
            .ok_or_else(|| DomainError::regra("Item não pertence a este pedido.".to_string()))?;
            let (_idlinha, pedida, recebida, nome_item) = linha;

            let falta = pedida - recebida;
            if falta <= 0 {
                return Err(DomainError::regra(format!(
                    "'{nome_item}' já foi recebido integralmente."
                )));
            }
            if it.quantidade > falta {
                return Err(DomainError::regra(format!(
                    "Recebimento de '{nome_item}' excede o pendente ({falta})."
                )));
            }

            sqlx::query(
                "UPDATE pedido_compra_item
                 SET quantidade_recebida = quantidade_recebida + $2
                 WHERE id = $1",
            )
            .bind(_idlinha)
            .bind(it.quantidade)
            .execute(&mut *tx)
            .await
            .map_err(map_db_err)?;

            sqlx::query(
                "UPDATE estoque SET quantidade = quantidade + $2, atualizado_em = now()
                 WHERE id = $1",
            )
            .bind(it.iditem)
            .bind(it.quantidade)
            .execute(&mut *tx)
            .await
            .map_err(map_db_err)?;

            sqlx::query(
                "INSERT INTO movimento_estoque (iditem, tipo, quantidade, idfuncionario, motivo)
                 VALUES ($1, 'entrada', $2, $3, $4)",
            )
            .bind(it.iditem)
            .bind(it.quantidade)
            .bind(idfuncionario)
            .bind(format!("Recebimento pedido Nº{idpedido} — {nome_item}"))
            .execute(&mut *tx)
            .await
            .map_err(map_db_err)?;
        }

        // recalcula o status: recebido quando todas as linhas fecham
        let novo_status: String = sqlx::query_scalar(
            "UPDATE pedido_compra SET
                 status = CASE WHEN NOT EXISTS (
                     SELECT 1 FROM pedido_compra_item i
                     WHERE i.idpedido = $1 AND i.quantidade_recebida < i.quantidade
                 ) THEN 'recebido' ELSE 'parcial' END,
                 atualizado_em = now()
             WHERE id = $1
             RETURNING status",
        )
        .bind(idpedido)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;

        let ped = sqlx::query_as::<_, PedidoCompra>(&format!(
            "SELECT {PED_COLS} FROM pedido_compra WHERE id = $1"
        ))
        .bind(idpedido)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;
        let _ = novo_status;

        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(ped)
    }

    async fn cancelar_pedido(&self, id: i64, log: NovoLog) -> Result<(), DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let r = sqlx::query(
            "UPDATE pedido_compra SET status = 'cancelado', atualizado_em = now()
             WHERE id = $1 AND status IN ('pendente', 'parcial')",
        )
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(map_db_err)?;
        if r.rows_affected() == 0 {
            return Err(DomainError::regra("Pedido não encontrado ou já encerrado."));
        }
        // cancela a conta a pagar vinculada se ainda estiver aberta
        sqlx::query(
            "UPDATE lancamento SET status = 'cancelado', atualizado_em = now()
             WHERE id = (SELECT idlancamento FROM pedido_compra WHERE id = $1)
               AND status = 'aberto'",
        )
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(map_db_err)?;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(())
    }
}
