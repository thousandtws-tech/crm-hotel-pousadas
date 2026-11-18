//! PDV & Comandas — mesas, comandas, garçons e comissões.
//!
//! Baixa automática de estoque: cada item lançado debita
//! `estoque.quantidade` e grava `movimento_estoque` 'saida' na mesma tx;
//! cancelamento devolve com 'entrada'. Fechamento cria o espelho
//! financeiro (lancamento receber + baixa ou título em aberto p/ quarto)
//! e provisiona a comissão — tudo atomicamente.

use super::audit;
use crate::persistence::db::map_db_err;
use async_trait::async_trait;
use chrono::NaiveDate;
use clarituz_domain::entities::{
    NovoLog, PdvComanda, PdvComandaItem, PdvComissao, PdvGarcom, PdvMesa,
};
use clarituz_domain::enums::{PdvComandaStatus, PdvComandaTipo, PdvComissaoStatus};
use clarituz_domain::ports::{
    FechamentoComanda, FiltroComanda, FiltroComissao, ModoFechamento, NovaComanda, NovoItemComanda,
    PdvRepository,
};
use clarituz_domain::queries::{
    ComandaItemView, ComandaView, ComissaoResumo, ComissaoView, FilaItemView, GarcomView,
    ItemVendaView, MesaView,
};
use clarituz_domain::DomainError;
use clarituz_shared::{Page, PageParams};
use rust_decimal::Decimal;
use sqlx::PgPool;

#[derive(Clone)]
pub struct PgPdvRepository {
    pool: PgPool,
}
impl PgPdvRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

const MESA_COLS: &str = "id, numero, lugares, ativo, version, criado_em, atualizado_em";

const COMANDA_COLS: &str = "id, tipo, idmesa, idquarto, idreserva, idcliente,
     idgarcom, rotulo, status, subtotal, desconto, total, idforma_pagamento,
     idlancamento, aberto_em, fechado_em, observacao, version, criado_em,
     atualizado_em";

const COMANDA_VIEW_SQL: &str = "
    SELECT c.id, c.tipo, c.idmesa, m.numero AS mesa_numero,
           c.idquarto, q.numero AS quarto_numero,
           c.idreserva, c.idcliente, cl.nome AS cliente_nome,
           c.idgarcom, g.nome AS garcom_nome,
           c.rotulo, c.status,
           COALESCE(t.total_itens, 0) AS total_itens,
           COALESCE(t.pendentes, 0)   AS itens_pendentes,
           c.desconto, c.total, c.idlancamento,
           c.aberto_em, c.fechado_em, c.version
    FROM pdv_comanda c
    LEFT JOIN pdv_mesa   m  ON m.id  = c.idmesa
    LEFT JOIN quarto     q  ON q.id  = c.idquarto
    LEFT JOIN cliente    cl ON cl.id = c.idcliente
    LEFT JOIN funcionario g ON g.id  = c.idgarcom
    LEFT JOIN (
        SELECT idcomanda,
               SUM(valor_total) AS total_itens,
               COUNT(*) FILTER (WHERE status != 'cancelado') AS pendentes
        FROM pdv_comanda_item
        WHERE status != 'cancelado'
        GROUP BY idcomanda
    ) t ON t.idcomanda = c.id";

const ITEM_VIEW_SQL: &str = "
    SELECT i.id, i.idcomanda, i.iditem, e.nome AS item_nome,
           ce.nome AS categoria_nome,
           i.quantidade, i.valor_unit, i.valor_total, i.status,
           i.lancado_por, lf.nome AS lancado_por_nome,
           cf.nome AS cancelado_por_nome, i.motivo_cancelamento, i.criado_em
    FROM pdv_comanda_item i
    JOIN estoque e ON e.id = i.iditem
    LEFT JOIN categoria_estoque ce ON ce.id = e.idcategoria
    LEFT JOIN funcionario lf ON lf.id = i.lancado_por
    LEFT JOIN funcionario cf ON cf.id = i.cancelado_por";

#[async_trait]
impl PdvRepository for PgPdvRepository {
    // ------------------------------------------------------------------ mesas

    async fn listar_mesas(&self) -> Result<Vec<MesaView>, DomainError> {
        sqlx::query_as::<_, MesaView>(
            "SELECT m.id, m.numero, m.lugares, m.ativo,
                    c.id AS idcomanda, c.subtotal AS total_aberto,
                    g.nome AS garcom_nome
             FROM pdv_mesa m
             LEFT JOIN pdv_comanda c
                    ON c.idmesa = m.id AND c.status = 'aberta'
             LEFT JOIN funcionario g ON g.id = c.idgarcom
             WHERE m.ativo
             ORDER BY m.numero",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn criar_mesa(
        &self,
        numero: &str,
        lugares: i32,
        log: NovoLog,
    ) -> Result<PdvMesa, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let mesa = sqlx::query_as::<_, PdvMesa>(&format!(
            "INSERT INTO pdv_mesa (numero, lugares) VALUES ($1, $2)
             RETURNING {MESA_COLS}"
        ))
        .bind(numero)
        .bind(lugares)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(mesa)
    }

    async fn status_mesa(
        &self,
        id: i64,
        ativo: bool,
        log: NovoLog,
    ) -> Result<PdvMesa, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        if !ativo {
            // não desativa mesa com comanda aberta
            let ocupada: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM pdv_comanda
                                WHERE idmesa = $1 AND status = 'aberta')",
            )
            .bind(id)
            .fetch_one(&mut *tx)
            .await
            .map_err(map_db_err)?;
            if ocupada {
                return Err(DomainError::regra(
                    "A mesa tem uma comanda aberta — feche-a antes de desativar.",
                ));
            }
        }
        let mesa = sqlx::query_as::<_, PdvMesa>(&format!(
            "UPDATE pdv_mesa SET ativo = $2, atualizado_em = now()
             WHERE id = $1 RETURNING {MESA_COLS}"
        ))
        .bind(id)
        .bind(ativo)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| DomainError::nao_encontrado("Mesa não encontrada."))?;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(mesa)
    }

    // ---------------------------------------------------------------- garçons

    async fn listar_garcons(&self) -> Result<Vec<GarcomView>, DomainError> {
        sqlx::query_as::<_, GarcomView>(
            "SELECT g.id, g.idfuncionario, f.nome AS funcionario_nome,
                    g.percentual, g.ativo
             FROM pdv_garcom g
             JOIN funcionario f ON f.id = g.idfuncionario
             ORDER BY f.nome",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn salvar_garcom(
        &self,
        idfuncionario: i64,
        percentual: Decimal,
        ativo: bool,
        log: NovoLog,
    ) -> Result<PdvGarcom, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let existe: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM funcionario WHERE id = $1 AND ativo)")
                .bind(idfuncionario)
                .fetch_one(&mut *tx)
                .await
                .map_err(map_db_err)?;
        if !existe {
            return Err(DomainError::nao_encontrado("Funcionário não encontrado."));
        }
        let garcom = sqlx::query_as::<_, PdvGarcom>(
            "INSERT INTO pdv_garcom (idfuncionario, percentual, ativo)
             VALUES ($1, $2, $3)
             ON CONFLICT (idfuncionario)
             DO UPDATE SET percentual = $2, ativo = $3, atualizado_em = now()
             RETURNING id, idfuncionario, percentual, ativo, criado_em, atualizado_em",
        )
        .bind(idfuncionario)
        .bind(percentual)
        .bind(ativo)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(garcom)
    }

    // --------------------------------------------------------------- comandas

    async fn listar_comandas(
        &self,
        filtro: &FiltroComanda,
        page: PageParams,
    ) -> Result<Page<ComandaView>, DomainError> {
        use std::fmt::Write as _;

        let mut wh = String::from("WHERE TRUE");
        let mut binds: Vec<String> = Vec::new();
        let mut n = 0i32;
        let push =
            |wh: &mut String, binds: &mut Vec<String>, n: &mut i32, frag: &str, v: String| {
                *n += 1;
                let _ = write!(wh, " AND {frag} = ${n}");
                binds.push(v);
            };
        if let Some(t) = &filtro.tipo {
            let v = match t {
                PdvComandaTipo::Mesa => "mesa",
                PdvComandaTipo::Quarto => "quarto",
                PdvComandaTipo::Balcao => "balcao",
            };
            push(&mut wh, &mut binds, &mut n, "c.tipo::text", v.into());
        }
        if let Some(s) = &filtro.status {
            let v = match s {
                PdvComandaStatus::Aberta => "aberta",
                PdvComandaStatus::Fechada => "fechada",
                PdvComandaStatus::Cancelada => "cancelada",
            };
            push(&mut wh, &mut binds, &mut n, "c.status::text", v.into());
        }
        if let Some(g) = filtro.idgarcom {
            push(
                &mut wh,
                &mut binds,
                &mut n,
                "c.idgarcom::text",
                g.to_string(),
            );
        }
        if let Some(d) = filtro.inicio {
            n += 1;
            let _ = write!(wh, " AND c.aberto_em::date >= ${n}::date");
            binds.push(d.to_string());
        }
        if let Some(d) = filtro.fim {
            n += 1;
            let _ = write!(wh, " AND c.aberto_em::date <= ${n}::date");
            binds.push(d.to_string());
        }

        let count_sql = format!("SELECT COUNT(*) FROM pdv_comanda c {wh}");
        let list_sql = format!(
            "{COMANDA_VIEW_SQL} {wh} ORDER BY c.aberto_em DESC LIMIT {} OFFSET {}",
            n + 1,
            n + 2
        );
        let mut cq = sqlx::query_scalar::<_, i64>(&count_sql);
        let mut lq = sqlx::query_as::<_, ComandaView>(&list_sql);
        for b in &binds {
            cq = cq.bind(b.clone());
            lq = lq.bind(b.clone());
        }
        let total = cq.fetch_one(&self.pool).await.map_err(map_db_err)?;
        let items = lq
            .bind(page.limit())
            .bind(page.offset())
            .fetch_all(&self.pool)
            .await
            .map_err(map_db_err)?;
        Ok(Page::new(items, page, total))
    }

    async fn buscar_comanda(&self, id: i64) -> Result<Option<ComandaView>, DomainError> {
        sqlx::query_as::<_, ComandaView>(&format!("{COMANDA_VIEW_SQL} WHERE c.id = $1"))
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map_err(map_db_err)
    }

    async fn listar_itens(&self, idcomanda: i64) -> Result<Vec<ComandaItemView>, DomainError> {
        sqlx::query_as::<_, ComandaItemView>(&format!(
            "{ITEM_VIEW_SQL} WHERE i.idcomanda = $1 ORDER BY i.criado_em"
        ))
        .bind(idcomanda)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn abrir_comanda(
        &self,
        nova: &NovaComanda,
        _idfuncionario: i64,
        log: NovoLog,
    ) -> Result<PdvComanda, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;

        // mesa: existe, ativa, sem comanda aberta
        if nova.tipo == PdvComandaTipo::Mesa {
            let idmesa = nova
                .idmesa
                .ok_or_else(|| DomainError::validacao("Comanda de mesa exige uma mesa."))?;
            let ativa: bool =
                sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pdv_mesa WHERE id = $1 AND ativo)")
                    .bind(idmesa)
                    .fetch_one(&mut *tx)
                    .await
                    .map_err(map_db_err)?;
            if !ativa {
                return Err(DomainError::nao_encontrado(
                    "Mesa não encontrada ou inativa.",
                ));
            }
        }

        // quarto: existe + reserva em estadia (faturar no checkout)
        let (mut idreserva, mut idcliente) = (None, nova.idcliente);
        if nova.tipo == PdvComandaTipo::Quarto {
            let idquarto = nova
                .idquarto
                .ok_or_else(|| DomainError::validacao("Comanda de quarto exige um quarto."))?;
            let res = sqlx::query_as::<_, (i64, i64)>(
                "SELECT id, idcliente FROM reserva
                 WHERE idquarto = $1 AND status = 'i'
                 ORDER BY checkin_em DESC LIMIT 1",
            )
            .bind(idquarto)
            .fetch_optional(&mut *tx)
            .await
            .map_err(map_db_err)?;
            match res {
                Some((r, c)) => {
                    idreserva = Some(r);
                    idcliente = nova.idcliente.or(Some(c));
                }
                None => {
                    return Err(DomainError::regra(
                        "O quarto não tem reserva em estadia — não é possível faturar.",
                    ))
                }
            }
        }

        // garçom: cadastrado e ativo
        if let Some(g) = nova.idgarcom {
            let ok: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM pdv_garcom
                                WHERE idfuncionario = $1 AND ativo)",
            )
            .bind(g)
            .fetch_one(&mut *tx)
            .await
            .map_err(map_db_err)?;
            if !ok {
                return Err(DomainError::regra(
                    "Garçom não cadastrado ou inativo no PDV.",
                ));
            }
        }

        let comanda = sqlx::query_as::<_, PdvComanda>(&format!(
            "INSERT INTO pdv_comanda
                 (tipo, idmesa, idquarto, idreserva, idcliente, idgarcom, rotulo)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING {COMANDA_COLS}"
        ))
        .bind(nova.tipo)
        .bind(nova.idmesa)
        .bind(nova.idquarto)
        .bind(idreserva)
        .bind(idcliente)
        .bind(nova.idgarcom)
        .bind(nova.rotulo.as_deref().map(str::trim))
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| {
            // índice parcial: mesa já tem comanda aberta
            let mapped = map_db_err(e);
            if matches!(mapped, DomainError::Conflito(_)) {
                DomainError::conflito("A mesa já tem uma comanda aberta.")
            } else {
                mapped
            }
        })?;

        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(comanda)
    }

    async fn adicionar_item(
        &self,
        idcomanda: i64,
        item: &NovoItemComanda,
        idfuncionario: i64,
        log: NovoLog,
    ) -> Result<PdvComandaItem, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;

        // trava a comanda — só aberta aceita item
        let status = sqlx::query_scalar::<_, PdvComandaStatus>(
            "SELECT status FROM pdv_comanda WHERE id = $1 FOR UPDATE",
        )
        .bind(idcomanda)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| DomainError::nao_encontrado("Comanda não encontrada."))?;
        if status != PdvComandaStatus::Aberta {
            return Err(DomainError::regra("A comanda não está aberta."));
        }

        // trava o estoque e debita — preço real do cadastro
        let (nome_item, qtd_atual, valor_unit) = sqlx::query_as::<_, (String, i32, Decimal)>(
            "SELECT nome, quantidade, valor_unitario FROM estoque
             WHERE id = $1 AND ativo FOR UPDATE",
        )
        .bind(item.iditem)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| DomainError::nao_encontrado("Item de estoque não encontrado."))?;

        // baixa: insumos da ficha tecnica ou o proprio item
        for (idalvo, nome_alvo, qtd_alvo) in
            Self::componentes_baixa(&mut tx, item.iditem, item.quantidade).await?
        {
            if idalvo == item.iditem && item.quantidade > qtd_atual {
                return Err(DomainError::regra(format!(
                    "Quantidade insuficiente de '{nome_item}' em estoque \
                     (disponível: {qtd_atual})."
                )));
            }
            let r = sqlx::query(
                "UPDATE estoque SET quantidade = quantidade - $2, atualizado_em = now()
                 WHERE id = $1 AND ativo AND quantidade >= $2",
            )
            .bind(idalvo)
            .bind(qtd_alvo)
            .execute(&mut *tx)
            .await
            .map_err(map_db_err)?;
            if r.rows_affected() == 0 {
                return Err(DomainError::regra(format!(
                    "Estoque insuficiente de '{nome_alvo}' para '{nome_item}'."
                )));
            }
            sqlx::query(
                "INSERT INTO movimento_estoque (iditem, tipo, quantidade, idfuncionario, motivo)
                 VALUES ($1, 'saida', $2, $3, $4)",
            )
            .bind(idalvo)
            .bind(qtd_alvo)
            .bind(idfuncionario)
            .bind(format!("Comanda Nº{idcomanda} — {nome_item}"))
            .execute(&mut *tx)
            .await
            .map_err(map_db_err)?;
        }

        let valor_total = valor_unit * Decimal::from(item.quantidade);
        let lancado = sqlx::query_as::<_, PdvComandaItem>(
            "INSERT INTO pdv_comanda_item
                 (idcomanda, iditem, quantidade, valor_unit, valor_total, lancado_por)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, idcomanda, iditem, quantidade, valor_unit, valor_total,
                       status, lancado_por, cancelado_por, motivo_cancelamento,
                       criado_em, atualizado_em",
        )
        .bind(idcomanda)
        .bind(item.iditem)
        .bind(item.quantidade)
        .bind(valor_unit)
        .bind(valor_total)
        .bind(idfuncionario)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;

        sqlx::query(
            "UPDATE pdv_comanda SET
                subtotal = (SELECT COALESCE(SUM(valor_total), 0) FROM pdv_comanda_item
                            WHERE idcomanda = $1 AND status != 'cancelado'),
                atualizado_em = now()
             WHERE id = $1",
        )
        .bind(idcomanda)
        .execute(&mut *tx)
        .await
        .map_err(map_db_err)?;

        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(lancado)
    }

    async fn entregar_item(
        &self,
        idcomanda: i64,
        iditem_comanda: i64,
        log: NovoLog,
    ) -> Result<PdvComandaItem, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let item = sqlx::query_as::<_, PdvComandaItem>(
            "UPDATE pdv_comanda_item SET status = 'entregue', atualizado_em = now()
             WHERE id = $1 AND idcomanda = $2
               AND status IN ('pendente', 'em_preparo', 'pronto')
             RETURNING id, idcomanda, iditem, quantidade, valor_unit, valor_total,
                       status, lancado_por, cancelado_por, motivo_cancelamento,
                       criado_em, atualizado_em",
        )
        .bind(iditem_comanda)
        .bind(idcomanda)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| DomainError::regra("Item não encontrado ou já entregue/cancelado."))?;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(item)
    }

    async fn cancelar_item(
        &self,
        idcomanda: i64,
        iditem_comanda: i64,
        motivo: Option<&str>,
        idfuncionario: i64,
        log: NovoLog,
    ) -> Result<PdvComandaItem, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;

        // trava a comanda — só aberta admite estorno
        let status = sqlx::query_scalar::<_, PdvComandaStatus>(
            "SELECT status FROM pdv_comanda WHERE id = $1 FOR UPDATE",
        )
        .bind(idcomanda)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| DomainError::nao_encontrado("Comanda não encontrada."))?;
        if status != PdvComandaStatus::Aberta {
            return Err(DomainError::regra("A comanda não está aberta."));
        }

        // item ativo da comanda
        let item = sqlx::query_as::<_, (i64, i32)>(
            "SELECT iditem, quantidade FROM pdv_comanda_item
             WHERE id = $1 AND idcomanda = $2 AND status != 'cancelado'
             FOR UPDATE",
        )
        .bind(iditem_comanda)
        .bind(idcomanda)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| DomainError::regra("Item não encontrado ou já cancelado."))?;

        // devolve ao estoque + estorno auditável (insumos da ficha ou o item)
        for (idalvo, _nome_alvo, qtd_alvo) in
            Self::componentes_baixa(&mut tx, item.0, item.1).await?
        {
            sqlx::query(
                "UPDATE estoque SET quantidade = quantidade + $2, atualizado_em = now()
                 WHERE id = $1",
            )
            .bind(idalvo)
            .bind(qtd_alvo)
            .execute(&mut *tx)
            .await
            .map_err(map_db_err)?;
            sqlx::query(
                "INSERT INTO movimento_estoque (iditem, tipo, quantidade, idfuncionario, motivo)
                 VALUES ($1, 'entrada', $2, $3, $4)",
            )
            .bind(idalvo)
            .bind(qtd_alvo)
            .bind(idfuncionario)
            .bind(format!(
                "Estorno comanda Nº{idcomanda}{}",
                motivo.map_or_default(|m| format!(" — {}", m.trim()))
            ))
            .execute(&mut *tx)
            .await
            .map_err(map_db_err)?;
        }

        let cancelado = sqlx::query_as::<_, PdvComandaItem>(
            "UPDATE pdv_comanda_item SET
                status = 'cancelado', cancelado_por = $3,
                motivo_cancelamento = $4, atualizado_em = now()
             WHERE id = $1 AND idcomanda = $2
             RETURNING id, idcomanda, iditem, quantidade, valor_unit, valor_total,
                       status, lancado_por, cancelado_por, motivo_cancelamento,
                       criado_em, atualizado_em",
        )
        .bind(iditem_comanda)
        .bind(idcomanda)
        .bind(idfuncionario)
        .bind(motivo.map(|m| m.trim().to_string()))
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;

        sqlx::query(
            "UPDATE pdv_comanda SET
                subtotal = (SELECT COALESCE(SUM(valor_total), 0) FROM pdv_comanda_item
                            WHERE idcomanda = $1 AND status != 'cancelado'),
                atualizado_em = now()
             WHERE id = $1",
        )
        .bind(idcomanda)
        .execute(&mut *tx)
        .await
        .map_err(map_db_err)?;

        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(cancelado)
    }

    async fn cancelar_comanda(
        &self,
        idcomanda: i64,
        motivo: Option<&str>,
        idfuncionario: i64,
        log: NovoLog,
    ) -> Result<PdvComanda, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;

        let status = sqlx::query_scalar::<_, PdvComandaStatus>(
            "SELECT status FROM pdv_comanda WHERE id = $1 FOR UPDATE",
        )
        .bind(idcomanda)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| DomainError::nao_encontrado("Comanda não encontrada."))?;
        if status != PdvComandaStatus::Aberta {
            return Err(DomainError::regra("Só é possível cancelar comanda aberta."));
        }

        // devolve todos os itens ativos ao estoque
        let itens = sqlx::query_as::<_, (i64, i64, i32, String)>(
            "SELECT i.id, i.iditem, i.quantidade, e.nome
             FROM pdv_comanda_item i
             JOIN estoque e ON e.id = i.iditem
             WHERE i.idcomanda = $1 AND i.status != 'cancelado'
             ORDER BY i.id FOR UPDATE OF i",
        )
        .bind(idcomanda)
        .fetch_all(&mut *tx)
        .await
        .map_err(map_db_err)?;

        for (id_item_comanda, iditem, qtd, nome) in &itens {
            for (idalvo, _nome_alvo, qtd_alvo) in
                Self::componentes_baixa(&mut tx, *iditem, *qtd).await?
            {
                sqlx::query(
                    "UPDATE estoque SET quantidade = quantidade + $2, atualizado_em = now()
                     WHERE id = $1",
                )
                .bind(idalvo)
                .bind(qtd_alvo)
                .execute(&mut *tx)
                .await
                .map_err(map_db_err)?;
                sqlx::query(
                    "INSERT INTO movimento_estoque
                         (iditem, tipo, quantidade, idfuncionario, motivo)
                     VALUES ($1, 'entrada', $2, $3, $4)",
                )
                .bind(idalvo)
                .bind(qtd_alvo)
                .bind(idfuncionario)
                .bind(format!("Estorno comanda Nº{idcomanda} — {nome}"))
                .execute(&mut *tx)
                .await
                .map_err(map_db_err)?;
            }
            sqlx::query(
                "UPDATE pdv_comanda_item SET
                    status = 'cancelado', cancelado_por = $2,
                    motivo_cancelamento = $3, atualizado_em = now()
                 WHERE id = $1",
            )
            .bind(id_item_comanda)
            .bind(idfuncionario)
            .bind(motivo.map(|m| m.trim().to_string()))
            .execute(&mut *tx)
            .await
            .map_err(map_db_err)?;
        }

        let comanda = sqlx::query_as::<_, PdvComanda>(&format!(
            "UPDATE pdv_comanda SET
                status = 'cancelada', subtotal = 0, total = 0,
                observacao = COALESCE($2, observacao), atualizado_em = now()
             WHERE id = $1 RETURNING {COMANDA_COLS}"
        ))
        .bind(idcomanda)
        .bind(motivo.map(|m| m.trim().to_string()))
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;

        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(comanda)
    }

    async fn fechar_comanda(
        &self,
        idcomanda: i64,
        f: &FechamentoComanda,
        idfuncionario: i64,
        log: NovoLog,
    ) -> Result<PdvComanda, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;

        // trava a comanda
        let comanda = sqlx::query_as::<_, PdvComanda>(&format!(
            "SELECT {COMANDA_COLS} FROM pdv_comanda WHERE id = $1 FOR UPDATE"
        ))
        .bind(idcomanda)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| DomainError::nao_encontrado("Comanda não encontrada."))?;
        if comanda.status != PdvComandaStatus::Aberta {
            return Err(DomainError::regra("A comanda não está aberta."));
        }

        // total real — sempre derivado dos itens, nunca da requisição
        let subtotal = sqlx::query_scalar::<_, Decimal>(
            "SELECT COALESCE(SUM(valor_total), 0) FROM pdv_comanda_item
             WHERE idcomanda = $1 AND status != 'cancelado'",
        )
        .bind(idcomanda)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;
        if subtotal <= Decimal::ZERO {
            return Err(DomainError::regra(
                "A comanda não tem itens — não é possível fechar.",
            ));
        }
        if f.desconto > subtotal {
            return Err(DomainError::validacao(
                "Desconto não pode superar o subtotal da comanda.",
            ));
        }
        let total = subtotal - f.desconto;

        // faturar exige reserva em estadia vinculada
        if f.modo == ModoFechamento::Faturar && comanda.idreserva.is_none() {
            return Err(DomainError::regra(
                "Só é possível faturar comanda de quarto com reserva em estadia.",
            ));
        }
        if f.modo == ModoFechamento::Pagar
            && (f.idconta_financeira.is_none() || f.idforma_pagamento.is_none())
        {
            return Err(DomainError::validacao(
                "Pagamento exige conta financeira e forma de pagamento.",
            ));
        }

        // descrição humana da comanda p/ o lançamento
        let descricao = match comanda.tipo {
            PdvComandaTipo::Mesa => format!("Comanda Nº{idcomanda} — Mesa"),
            PdvComandaTipo::Quarto => format!("Comanda Nº{idcomanda} — Quarto"),
            PdvComandaTipo::Balcao => format!(
                "Comanda Nº{idcomanda} — {}",
                comanda.rotulo.as_deref().unwrap_or("Balcão")
            ),
        };

        // conta do plano de contas 'Alimentos e bebidas' (1.02)
        let idplano = sqlx::query_scalar::<_, Option<i64>>(
            "SELECT id FROM plano_conta WHERE codigo = '1.02' AND ativo",
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .flatten();

        // espelho financeiro — lançamento a receber
        let lanc = sqlx::query_scalar::<_, i64>(
            "INSERT INTO lancamento
                 (tipo, descricao, idplano_conta, idconta_financeira,
                  favorecido, documento, idcliente, idreserva, valor,
                  emissao, vencimento, competencia, status, observacao,
                  idfuncionario)
             VALUES ('receber', $1, $2, $3,
                     $4, $5, $6, $7, $8,
                     CURRENT_DATE, CURRENT_DATE, CURRENT_DATE, 'aberto', $9,
                     $10)
             RETURNING id",
        )
        .bind(&descricao)
        .bind(idplano)
        .bind(f.idconta_financeira)
        .bind(
            comanda
                .rotulo
                .clone()
                .or_else(|| Some("Consumo PDV".into())),
        )
        .bind(format!("comanda-{idcomanda}"))
        .bind(comanda.idcliente)
        .bind(comanda.idreserva)
        .bind(total)
        .bind(f.observacao.as_deref().map(str::trim))
        .bind(idfuncionario)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;

        // pagamento à vista → baixa que quita o título
        if f.modo == ModoFechamento::Pagar {
            sqlx::query(
                "INSERT INTO baixa_lancamento
                     (idlancamento, idconta_financeira, valor, data,
                      idforma_pagamento, observacao, idfuncionario)
                 VALUES ($1, $2, $3, CURRENT_DATE, $4, $5, $6)",
            )
            .bind(lanc)
            .bind(f.idconta_financeira)
            .bind(total)
            .bind(f.idforma_pagamento)
            .bind(f.observacao.as_deref().map(str::trim))
            .bind(idfuncionario)
            .execute(&mut *tx)
            .await
            .map_err(map_db_err)?;
            sqlx::query(
                "UPDATE lancamento SET valor_liquidado = valor, status = 'liquidado',
                     atualizado_em = now() WHERE id = $1",
            )
            .bind(lanc)
            .execute(&mut *tx)
            .await
            .map_err(map_db_err)?;
        }

        // comissão — snapshot do % vigente do garçom
        if let Some(g) = comanda.idgarcom {
            let pct = sqlx::query_scalar::<_, Option<Decimal>>(
                "SELECT percentual FROM pdv_garcom
                  WHERE idfuncionario = $1 AND ativo",
            )
            .bind(g)
            .fetch_optional(&mut *tx)
            .await
            .map_err(map_db_err)?
            .flatten();
            if let Some(pct) = pct.filter(|p| *p > Decimal::ZERO) {
                let valor = (total * pct / Decimal::from(100)).round_dp(2);
                sqlx::query(
                    "INSERT INTO pdv_comissao
                         (idgarcom, idcomanda, percentual, base, valor)
                     VALUES ($1, $2, $3, $4, $5)",
                )
                .bind(g)
                .bind(idcomanda)
                .bind(pct)
                .bind(total)
                .bind(valor)
                .execute(&mut *tx)
                .await
                .map_err(map_db_err)?;
            }
        }

        let fechada = sqlx::query_as::<_, PdvComanda>(&format!(
            "UPDATE pdv_comanda SET
                status = 'fechada', subtotal = $2, desconto = $3, total = $4,
                idforma_pagamento = $5, idlancamento = $6, fechado_em = now(),
                atualizado_em = now()
             WHERE id = $1 RETURNING {COMANDA_COLS}"
        ))
        .bind(idcomanda)
        .bind(subtotal)
        .bind(f.desconto)
        .bind(total)
        .bind(f.idforma_pagamento)
        .bind(lanc)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;

        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(fechada)
    }

    // ------------------------------------------------- itens vendáveis + comissões

    async fn listar_itens_venda(
        &self,
        busca: Option<&str>,
    ) -> Result<Vec<ItemVendaView>, DomainError> {
        sqlx::query_as::<_, ItemVendaView>(
            "SELECT e.id, e.nome, ce.nome AS categoria_nome,
                    e.quantidade, e.valor_unitario
             FROM estoque e
             LEFT JOIN categoria_estoque ce ON ce.id = e.idcategoria
             WHERE e.ativo AND NOT e.eh_insumo
               AND (e.quantidade > 0
                    OR EXISTS (SELECT 1 FROM ficha_tecnica f WHERE f.idproduto = e.id))
               AND ($1 IS NULL OR e.nome ILIKE '%' || $1 || '%')
             ORDER BY e.nome LIMIT 100",
        )
        .bind(busca.map(str::trim))
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn listar_comissoes(
        &self,
        filtro: &FiltroComissao,
        page: PageParams,
    ) -> Result<Page<ComissaoView>, DomainError> {
        use std::fmt::Write as _;

        const SEL: &str = "
            SELECT cm.id, cm.idgarcom, f.nome AS garcom_nome,
                   cm.idcomanda,
                   CONCAT('Comanda Nº', cm.idcomanda) AS comanda_descricao,
                   cm.percentual, cm.base, cm.valor, cm.status,
                   cm.pago_em, cm.criado_em
            FROM pdv_comissao cm
            JOIN funcionario f ON f.id = cm.idgarcom";

        let mut wh = String::from("WHERE TRUE");
        let mut binds: Vec<String> = Vec::new();
        let mut n = 0i32;
        if let Some(g) = filtro.idgarcom {
            n += 1;
            let _ = write!(wh, " AND cm.idgarcom::text = ${n}");
            binds.push(g.to_string());
        }
        if filtro.apenas_pendentes {
            wh.push_str(" AND cm.status = 'pendente'");
        }
        if let Some(d) = filtro.inicio {
            n += 1;
            let _ = write!(wh, " AND cm.criado_em::date >= ${n}::date");
            binds.push(d.to_string());
        }
        if let Some(d) = filtro.fim {
            n += 1;
            let _ = write!(wh, " AND cm.criado_em::date <= ${n}::date");
            binds.push(d.to_string());
        }

        let count_sql = format!(
            "SELECT COUNT(*) FROM pdv_comissao cm JOIN funcionario f ON f.id = cm.idgarcom {wh}"
        );
        let list_sql = format!(
            "{SEL} {wh} ORDER BY cm.criado_em DESC LIMIT {} OFFSET {}",
            n + 1,
            n + 2
        );
        let mut cq = sqlx::query_scalar::<_, i64>(&count_sql);
        let mut lq = sqlx::query_as::<_, ComissaoView>(&list_sql);
        for b in &binds {
            cq = cq.bind(b.clone());
            lq = lq.bind(b.clone());
        }
        let total = cq.fetch_one(&self.pool).await.map_err(map_db_err)?;
        let items = lq
            .bind(page.limit())
            .bind(page.offset())
            .fetch_all(&self.pool)
            .await
            .map_err(map_db_err)?;
        Ok(Page::new(items, page, total))
    }

    async fn resumo_comissoes(
        &self,
        inicio: Option<NaiveDate>,
        fim: Option<NaiveDate>,
    ) -> Result<Vec<ComissaoResumo>, DomainError> {
        sqlx::query_as::<_, ComissaoResumo>(
            "SELECT cm.idgarcom, f.nome AS garcom_nome,
                    COUNT(*) FILTER (WHERE cm.status = 'pendente') AS comissoes_pendentes,
                    COALESCE(SUM(cm.valor) FILTER (WHERE cm.status = 'pendente'), 0) AS valor_pendente,
                    COALESCE(SUM(cm.valor) FILTER (WHERE cm.status = 'paga'), 0)    AS valor_pago
             FROM pdv_comissao cm
             JOIN funcionario f ON f.id = cm.idgarcom
             WHERE ($1::date IS NULL OR cm.criado_em::date >= $1)
               AND ($2::date IS NULL OR cm.criado_em::date <= $2)
             GROUP BY cm.idgarcom, f.nome
             ORDER BY valor_pendente DESC, f.nome",
        )
        .bind(inicio)
        .bind(fim)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn pagar_comissao(
        &self,
        idcomissao: i64,
        idconta_financeira: i64,
        idforma_pagamento: Option<i64>,
        idfuncionario: i64,
        log: NovoLog,
    ) -> Result<PdvComissao, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;

        let comissao = sqlx::query_as::<_, PdvComissao>(
            "SELECT id, idgarcom, idcomanda, percentual, base, valor, status,
                    idlancamento, pago_em, criado_em
             FROM pdv_comissao WHERE id = $1 FOR UPDATE",
        )
        .bind(idcomissao)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| DomainError::nao_encontrado("Comissão não encontrada."))?;
        if comissao.status != PdvComissaoStatus::Pendente {
            return Err(DomainError::regra("A comissão já foi paga."));
        }

        // conta financeira válida e ativa
        let conta_ok: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM conta_financeira WHERE id = $1 AND ativo)",
        )
        .bind(idconta_financeira)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;
        if !conta_ok {
            return Err(DomainError::nao_encontrado(
                "Conta financeira não encontrada.",
            ));
        }

        let nome_garcom =
            sqlx::query_scalar::<_, String>("SELECT nome FROM funcionario WHERE id = $1")
                .bind(comissao.idgarcom)
                .fetch_one(&mut *tx)
                .await
                .map_err(map_db_err)?;

        let idplano = sqlx::query_scalar::<_, Option<i64>>(
            "SELECT id FROM plano_conta WHERE codigo = '3.03' AND ativo",
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .flatten();

        // lançamento a pagar + baixa quitada na mesma tx
        let lanc = sqlx::query_scalar::<_, i64>(
            "INSERT INTO lancamento
                 (tipo, descricao, idplano_conta, idconta_financeira,
                  favorecido, documento, valor, emissao, vencimento,
                  competencia, status, observacao, idfuncionario)
             VALUES ('pagar', $1, $2, $3, $4, $5, $6,
                     CURRENT_DATE, CURRENT_DATE, CURRENT_DATE, 'aberto', $7, $8)
             RETURNING id",
        )
        .bind(format!(
            "Comissão Nº{idcomissao} — {nome_garcom} (comanda Nº{})",
            comissao.idcomanda
        ))
        .bind(idplano)
        .bind(idconta_financeira)
        .bind(&nome_garcom)
        .bind(format!("comissao-{idcomissao}"))
        .bind(comissao.valor)
        .bind(Some(format!(
            "{}% sobre {} — comanda Nº{}",
            comissao.percentual, comissao.base, comissao.idcomanda
        )))
        .bind(idfuncionario)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;

        sqlx::query(
            "INSERT INTO baixa_lancamento
                 (idlancamento, idconta_financeira, valor, data,
                  idforma_pagamento, observacao, idfuncionario)
             VALUES ($1, $2, $3, CURRENT_DATE, $4, $5, $6)",
        )
        .bind(lanc)
        .bind(idconta_financeira)
        .bind(comissao.valor)
        .bind(idforma_pagamento)
        .bind(Some(format!("Pagamento de comissão Nº{idcomissao}")))
        .bind(idfuncionario)
        .execute(&mut *tx)
        .await
        .map_err(map_db_err)?;

        sqlx::query(
            "UPDATE lancamento SET valor_liquidado = valor, status = 'liquidado',
                 atualizado_em = now() WHERE id = $1",
        )
        .bind(lanc)
        .execute(&mut *tx)
        .await
        .map_err(map_db_err)?;

        let paga = sqlx::query_as::<_, PdvComissao>(
            "UPDATE pdv_comissao SET
                status = 'paga', idlancamento = $2, pago_em = now()
             WHERE id = $1
             RETURNING id, idgarcom, idcomanda, percentual, base, valor,
                       status, idlancamento, pago_em, criado_em",
        )
        .bind(idcomissao)
        .bind(lanc)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;

        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(paga)
    }

    // ------------------------------------------------------------------ KDS

    async fn listar_fila_cozinha(&self) -> Result<Vec<FilaItemView>, DomainError> {
        sqlx::query_as::<_, FilaItemView>(
            "SELECT i.id, i.idcomanda, c.tipo AS comanda_tipo,
                    m.numero AS mesa_numero, q.numero AS quarto_numero,
                    c.rotulo, cl.nome AS cliente_nome, f.nome AS garcom_nome,
                    i.iditem, e.nome AS item_nome, ce.nome AS categoria_nome,
                    i.quantidade, i.status, i.criado_em,
                    c.aberto_em AS comanda_aberto_em
             FROM pdv_comanda_item i
             JOIN pdv_comanda c ON c.id = i.idcomanda AND c.status = 'aberta'
             LEFT JOIN pdv_mesa m ON m.id = c.idmesa
             LEFT JOIN quarto q ON q.id = c.idquarto
             LEFT JOIN cliente cl ON cl.id = c.idcliente
             LEFT JOIN funcionario f ON f.id = c.idgarcom
             JOIN estoque e ON e.id = i.iditem
             LEFT JOIN categoria_estoque ce ON ce.id = e.idcategoria
             WHERE i.status IN ('pendente', 'em_preparo', 'pronto')
             ORDER BY i.criado_em",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn iniciar_preparo(
        &self,
        idcomanda: i64,
        iditem_comanda: i64,
        log: NovoLog,
    ) -> Result<PdvComandaItem, DomainError> {
        self.transicao_item(idcomanda, iditem_comanda, "pendente", "em_preparo", log)
            .await
    }

    async fn marcar_pronto(
        &self,
        idcomanda: i64,
        iditem_comanda: i64,
        log: NovoLog,
    ) -> Result<PdvComandaItem, DomainError> {
        self.transicao_item(idcomanda, iditem_comanda, "em_preparo", "pronto", log)
            .await
    }

    async fn retornar_fila(
        &self,
        idcomanda: i64,
        iditem_comanda: i64,
        log: NovoLog,
    ) -> Result<PdvComandaItem, DomainError> {
        // devolve à fila tanto de em_preparo quanto de pronto
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let aberta: bool = sqlx::query_scalar(
            "SELECT status = 'aberta' FROM pdv_comanda WHERE id = $1 FOR UPDATE",
        )
        .bind(idcomanda)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| DomainError::nao_encontrado("Comanda não encontrada."))?;
        if !aberta {
            return Err(DomainError::regra("A comanda não está aberta."));
        }
        let item = sqlx::query_as::<_, PdvComandaItem>(
            "UPDATE pdv_comanda_item SET status = 'pendente', atualizado_em = now()
             WHERE id = $1 AND idcomanda = $2 AND status IN ('em_preparo', 'pronto')
             RETURNING id, idcomanda, iditem, quantidade, valor_unit, valor_total,
                       status, lancado_por, cancelado_por, motivo_cancelamento,
                       criado_em, atualizado_em",
        )
        .bind(iditem_comanda)
        .bind(idcomanda)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| DomainError::regra("Item não está em preparo/pronto."))?;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(item)
    }
}

impl PgPdvRepository {
    /// Transição de status com trava na comanda — KDS e PDV nunca pisam
    /// um no outro: só comanda aberta e só partindo do status esperado.
    /// Componentes da baixa: insumos da ficha tecnica do produto ou o proprio
    /// item quando nao ha ficha. Retorna (iditem, nome, quantidade_base).
    async fn componentes_baixa(
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        iditem: i64,
        quantidade: i32,
    ) -> Result<Vec<(i64, String, i64)>, DomainError> {
        let ficha = sqlx::query_as::<_, (i64, String, i64)>(
            "SELECT i.id, i.nome, f.quantidade::bigint * $2
             FROM ficha_tecnica f
             JOIN estoque i ON i.id = f.idinsumo
             WHERE f.idproduto = $1",
        )
        .bind(iditem)
        .bind(i64::from(quantidade))
        .fetch_all(&mut **tx)
        .await
        .map_err(map_db_err)?;
        if !ficha.is_empty() {
            return Ok(ficha);
        }
        let nome = sqlx::query_scalar::<_, String>("SELECT nome FROM estoque WHERE id = $1")
            .bind(iditem)
            .fetch_one(&mut **tx)
            .await
            .map_err(map_db_err)?;
        Ok(vec![(iditem, nome, i64::from(quantidade))])
    }

    async fn transicao_item(
        &self,
        idcomanda: i64,
        iditem_comanda: i64,
        de: &'static str,
        para: &'static str,
        log: NovoLog,
    ) -> Result<PdvComandaItem, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;

        let aberta: bool = sqlx::query_scalar(
            "SELECT status = 'aberta' FROM pdv_comanda WHERE id = $1 FOR UPDATE",
        )
        .bind(idcomanda)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| DomainError::nao_encontrado("Comanda não encontrada."))?;
        if !aberta {
            return Err(DomainError::regra("A comanda não está aberta."));
        }

        let item = sqlx::query_as::<_, PdvComandaItem>(&format!(
            "UPDATE pdv_comanda_item SET status = '{para}', atualizado_em = now()
                 WHERE id = $1 AND idcomanda = $2 AND status = '{de}'
                 RETURNING id, idcomanda, iditem, quantidade, valor_unit, valor_total,
                           status, lancado_por, cancelado_por, motivo_cancelamento,
                           criado_em, atualizado_em"
        ))
        .bind(iditem_comanda)
        .bind(idcomanda)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| DomainError::regra("Item não está no estado esperado para essa ação."))?;

        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(item)
    }
}
