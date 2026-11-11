//! Tesouraria: contas a pagar/receber, fluxo de caixa, DRE, conciliação
//! bancária e split payment IBS/CBS — todas as escritas em transações únicas
//! com auditoria no mesmo commit.

use super::audit;
use crate::persistence::db::{map_db_err, map_del_err};
use async_trait::async_trait;
use chrono::NaiveDate;
use clarituz_domain::entities::{
    BaixaLancamento, Conciliacao, ContaFinanceira, ExtratoItem, Lancamento, NovoLog, PlanoConta,
    TributoApuracao, TributoConfig,
};
use clarituz_domain::enums::{StatusExtrato, TipoLancamento};
use clarituz_domain::ports::{
    AtualizaContaFinanceira, AtualizaLancamento, AtualizaPlanoConta, FiltroExtrato,
    FiltroLancamento, ImportacaoExtrato, NovaBaixa, NovaContaFinanceira, NovaTributoConfig,
    NovoExtratoItem, NovoLancamento, NovoPlanoConta, TesourariaRepository,
};
use clarituz_domain::queries::{
    BaixaView, ConciliacaoResumo, Dre, DreLinha, ExtratoView, FluxoCaixa, FluxoCaixaDia,
    LancamentoView, SplitEventoView, SplitResumo, SugestaoConciliacao,
};
use clarituz_domain::value_objects::PeriodoEstadia;
use clarituz_domain::DomainError;
use clarituz_shared::{Page, PageParams};
use rust_decimal::Decimal;
use sqlx::PgPool;
use std::collections::HashSet;

#[derive(Clone)]
pub struct PgTesourariaRepository {
    pool: PgPool,
}
impl PgTesourariaRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

const PLANO_COLS: &str =
    "id, codigo, nome, tipo, grupo_dre, ativo, sistema, version, criado_em, atualizado_em";

const CONTA_COLS: &str = "id, nome, tipo, banco, agencia, conta, saldo_inicial,
     saldo_inicial_em, ativo, version, criado_em, atualizado_em";

const LANCAMENTO_COLS: &str = "id, tipo, descricao, idplano_conta, idconta_financeira,
     favorecido, documento, idcliente, idreserva, valor, valor_liquidado, emissao,
     vencimento, competencia, status, observacao, idfuncionario, version, criado_em, atualizado_em";

const BAIXA_COLS: &str = "id, idlancamento, idconta_financeira, valor, data,
     idforma_pagamento, observacao, idfuncionario, criado_em";

/// Provisiona o split de UMA baixa de recebimento dentro da tx aberta —
/// mesma regra do backfill: alíquota vigente na data da baixa; lançamento
/// vinculado a reserva com consumo concluído é coberto pelo split do consumo.
async fn provisionar_split_baixa(
    tx: &mut sqlx::PgConnection,
    idbaixa: i64,
) -> Result<(), DomainError> {
    sqlx::query(
        "INSERT INTO split_payment
            (origem, idorigem, base, aliq_ibs, aliq_cbs, valor_ibs, valor_cbs,
             valor_liquido, competencia)
         SELECT 'baixa', b.id, b.valor, t.aliq_ibs, t.aliq_cbs,
                ROUND(b.valor * t.aliq_ibs / 100, 2),
                ROUND(b.valor * t.aliq_cbs / 100, 2),
                b.valor - ROUND(b.valor * t.aliq_ibs / 100, 2)
                       - ROUND(b.valor * t.aliq_cbs / 100, 2),
                date_trunc('month', b.data)::date
         FROM baixa_lancamento b
         JOIN lancamento l ON l.id = b.idlancamento
         JOIN LATERAL (
            SELECT aliq_ibs, aliq_cbs FROM tributo_config
            WHERE vigente_desde <= b.data
            ORDER BY vigente_desde DESC LIMIT 1
         ) t ON true
         WHERE b.id = $1 AND l.tipo = 'receber' AND l.status != 'cancelado'
           AND NOT (l.idreserva IS NOT NULL AND EXISTS (
                SELECT 1 FROM consumo c
                WHERE c.idreserva = l.idreserva AND c.status = 'concluido'))
         ON CONFLICT (origem, idorigem) DO NOTHING",
    )
    .bind(idbaixa)
    .execute(tx)
    .await
    .map_err(map_db_err)?;
    Ok(())
}

#[async_trait]
impl TesourariaRepository for PgTesourariaRepository {
    // =======================================================================
    // plano de contas
    // =======================================================================

    async fn listar_plano_contas(
        &self,
        apenas_ativas: bool,
        tipo: Option<TipoLancamento>,
    ) -> Result<Vec<PlanoConta>, DomainError> {
        sqlx::query_as::<_, PlanoConta>(&format!(
            "SELECT {PLANO_COLS} FROM plano_conta
             WHERE ($1::bool = false OR ativo)
               AND ($2::lancamento_tipo IS NULL OR tipo = $2)
             ORDER BY codigo"
        ))
        .bind(apenas_ativas)
        .bind(tipo)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn criar_plano_conta(
        &self,
        novo: &NovoPlanoConta,
        log: NovoLog,
    ) -> Result<PlanoConta, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let c = sqlx::query_as::<_, PlanoConta>(&format!(
            "INSERT INTO plano_conta (codigo, nome, tipo, grupo_dre)
             VALUES ($1, $2, $3, $4) RETURNING {PLANO_COLS}"
        ))
        .bind(&novo.codigo)
        .bind(&novo.nome)
        .bind(novo.tipo)
        .bind(novo.grupo_dre)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;
        let mut log = log;
        log.idtabela = c.id;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(c)
    }

    async fn atualizar_plano_conta(
        &self,
        id: i64,
        d: &AtualizaPlanoConta,
        log: NovoLog,
    ) -> Result<PlanoConta, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let c = sqlx::query_as::<_, PlanoConta>(&format!(
            "UPDATE plano_conta SET
                codigo = COALESCE($2, codigo),
                nome = COALESCE($3, nome),
                tipo = COALESCE($4, tipo),
                grupo_dre = COALESCE($5, grupo_dre),
                atualizado_em = now()
             WHERE id = $1 AND ($6::bigint IS NULL OR version = $6)
             RETURNING {PLANO_COLS}"
        ))
        .bind(id)
        .bind(&d.codigo)
        .bind(&d.nome)
        .bind(d.tipo)
        .bind(d.grupo_dre)
        .bind(d.version)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| {
            DomainError::conflito("Conta alterada por outro usuário. Recarregue e tente novamente.")
        })?;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(c)
    }

    async fn definir_plano_conta_ativa(
        &self,
        id: i64,
        ativo: bool,
        log: NovoLog,
    ) -> Result<PlanoConta, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let c = sqlx::query_as::<_, PlanoConta>(&format!(
            "UPDATE plano_conta SET ativo = $2, atualizado_em = now()
             WHERE id = $1 RETURNING {PLANO_COLS}"
        ))
        .bind(id)
        .bind(ativo)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| DomainError::nao_encontrado("Conta não encontrada."))?;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(c)
    }

    async fn remover_plano_conta(&self, id: i64, log: NovoLog) -> Result<(), DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let r = sqlx::query("DELETE FROM plano_conta WHERE id = $1 AND NOT sistema")
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(|e| {
                map_del_err(
                    e,
                    "Conta possui lançamentos vinculados — inative-a no lugar.",
                )
            })?;
        if r.rows_affected() == 0 {
            let existe: bool =
                sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM plano_conta WHERE id = $1)")
                    .bind(id)
                    .fetch_one(&mut *tx)
                    .await
                    .map_err(map_db_err)?;
            return Err(if existe {
                DomainError::regra("Contas de sistema não podem ser excluídas — inative-a.")
            } else {
                DomainError::nao_encontrado("Conta não encontrada.")
            });
        }
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(())
    }

    // =======================================================================
    // contas financeiras
    // =======================================================================

    async fn listar_contas(
        &self,
        apenas_ativas: bool,
    ) -> Result<Vec<ContaFinanceira>, DomainError> {
        sqlx::query_as::<_, ContaFinanceira>(&format!(
            "SELECT {CONTA_COLS} FROM conta_financeira
             WHERE ($1::bool = false OR ativo) ORDER BY nome"
        ))
        .bind(apenas_ativas)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn criar_conta(
        &self,
        nova: &NovaContaFinanceira,
        log: NovoLog,
    ) -> Result<ContaFinanceira, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let c = sqlx::query_as::<_, ContaFinanceira>(&format!(
            "INSERT INTO conta_financeira
                (nome, tipo, banco, agencia, conta, saldo_inicial, saldo_inicial_em)
             VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, CURRENT_DATE))
             RETURNING {CONTA_COLS}"
        ))
        .bind(&nova.nome)
        .bind(nova.tipo)
        .bind(&nova.banco)
        .bind(&nova.agencia)
        .bind(&nova.conta)
        .bind(nova.saldo_inicial)
        .bind(nova.saldo_inicial_em)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;
        let mut log = log;
        log.idtabela = c.id;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(c)
    }

    async fn atualizar_conta(
        &self,
        id: i64,
        d: &AtualizaContaFinanceira,
        log: NovoLog,
    ) -> Result<ContaFinanceira, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let c = sqlx::query_as::<_, ContaFinanceira>(&format!(
            "UPDATE conta_financeira SET
                nome = COALESCE($2, nome),
                tipo = COALESCE($3, tipo),
                banco = COALESCE($4, banco),
                agencia = COALESCE($5, agencia),
                conta = COALESCE($6, conta),
                saldo_inicial = COALESCE($7, saldo_inicial),
                saldo_inicial_em = COALESCE($8, saldo_inicial_em),
                atualizado_em = now()
             WHERE id = $1 AND ($9::bigint IS NULL OR version = $9)
             RETURNING {CONTA_COLS}"
        ))
        .bind(id)
        .bind(&d.nome)
        .bind(d.tipo)
        .bind(&d.banco)
        .bind(&d.agencia)
        .bind(&d.conta)
        .bind(d.saldo_inicial)
        .bind(d.saldo_inicial_em)
        .bind(d.version)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| {
            DomainError::conflito("Conta alterada por outro usuário. Recarregue e tente novamente.")
        })?;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(c)
    }

    async fn definir_conta_ativa(
        &self,
        id: i64,
        ativo: bool,
        log: NovoLog,
    ) -> Result<ContaFinanceira, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let c = sqlx::query_as::<_, ContaFinanceira>(&format!(
            "UPDATE conta_financeira SET ativo = $2, atualizado_em = now()
             WHERE id = $1 RETURNING {CONTA_COLS}"
        ))
        .bind(id)
        .bind(ativo)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| DomainError::nao_encontrado("Conta não encontrada."))?;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(c)
    }

    async fn saldo_conta(&self, id: i64, ate: Option<NaiveDate>) -> Result<Decimal, DomainError> {
        sqlx::query_scalar::<_, Decimal>(
            "SELECT c.saldo_inicial + COALESCE((
                SELECT SUM(CASE WHEN l.tipo = 'receber' THEN b.valor ELSE -b.valor END)
                FROM baixa_lancamento b
                JOIN lancamento l ON l.id = b.idlancamento
                WHERE b.idconta_financeira = c.id
                  AND l.status != 'cancelado'
                  AND b.data <= COALESCE($2, CURRENT_DATE)
             ), 0)
             FROM conta_financeira c WHERE c.id = $1",
        )
        .bind(id)
        .bind(ate)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| DomainError::nao_encontrado("Conta não encontrada."))
    }

    // =======================================================================
    // lançamentos
    // =======================================================================

    async fn criar_lancamentos(
        &self,
        novos: &[NovoLancamento],
        log: NovoLog,
    ) -> Result<Vec<Lancamento>, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let mut criados = Vec::with_capacity(novos.len());
        for n in novos {
            let l = sqlx::query_as::<_, Lancamento>(&format!(
                "INSERT INTO lancamento
                    (tipo, descricao, idplano_conta, idconta_financeira, favorecido,
                     documento, idcliente, idreserva, valor, emissao, vencimento,
                     competencia, observacao)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
                        COALESCE($10, CURRENT_DATE), $11,
                        COALESCE($12, $11), $13)
                 RETURNING {LANCAMENTO_COLS}"
            ))
            .bind(n.tipo)
            .bind(&n.descricao)
            .bind(n.idplano_conta)
            .bind(n.idconta_financeira)
            .bind(&n.favorecido)
            .bind(&n.documento)
            .bind(n.idcliente)
            .bind(n.idreserva)
            .bind(n.valor)
            .bind(n.emissao)
            .bind(n.vencimento)
            .bind(n.competencia)
            .bind(&n.observacao)
            .fetch_one(&mut *tx)
            .await
            .map_err(map_db_err)?;
            criados.push(l);
        }
        let mut log = log;
        log.idtabela = criados.first().map_or(0, |l| l.id);
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(criados)
    }

    async fn buscar_lancamento(&self, id: i64) -> Result<Option<Lancamento>, DomainError> {
        sqlx::query_as::<_, Lancamento>(&format!(
            "SELECT {LANCAMENTO_COLS} FROM lancamento WHERE id = $1"
        ))
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn listar_lancamentos(
        &self,
        filtro: &FiltroLancamento,
        page: PageParams,
    ) -> Result<Page<LancamentoView>, DomainError> {
        const WHERE: &str = "
            WHERE ($1::lancamento_tipo IS NULL OR l.tipo = $1)
              AND ($2::lancamento_status IS NULL OR l.status = $2)
              AND ($3::bool = false OR
                   (l.status IN ('aberto','parcial') AND l.vencimento < CURRENT_DATE))
              AND ($4::date IS NULL OR l.vencimento >= $4)
              AND ($5::date IS NULL OR l.vencimento <= $5)
              AND ($6::bigint IS NULL OR l.idplano_conta = $6)
              AND ($7::text IS NULL
                   OR l.descricao ILIKE '%'||$7||'%'
                   OR l.favorecido ILIKE '%'||$7||'%'
                   OR l.documento ILIKE '%'||$7||'%')";

        let total =
            sqlx::query_scalar::<_, i64>(&format!("SELECT COUNT(*) FROM lancamento l {WHERE}"))
                .bind(filtro.tipo)
                .bind(filtro.status)
                .bind(filtro.vencidos)
                .bind(filtro.inicio)
                .bind(filtro.fim)
                .bind(filtro.idplano_conta)
                .bind(&filtro.busca)
                .fetch_one(&self.pool)
                .await
                .map_err(map_db_err)?;

        let items = sqlx::query_as::<_, LancamentoView>(&format!(
            "SELECT l.id, l.tipo, l.descricao, l.idplano_conta, pc.nome AS plano_conta,
                    pc.grupo_dre, l.idconta_financeira, cf.nome AS conta_financeira,
                    l.favorecido, l.documento, l.idcliente, cl.nome AS cliente_nome,
                    l.idreserva, l.valor, l.valor_liquidado,
                    (l.valor - l.valor_liquidado) AS saldo,
                    l.emissao, l.vencimento, l.competencia, l.status,
                    (l.vencimento < CURRENT_DATE
                     AND l.status IN ('aberto','parcial')) AS vencido,
                    l.observacao, l.version, l.criado_em
             FROM lancamento l
             LEFT JOIN plano_conta pc ON pc.id = l.idplano_conta
             LEFT JOIN conta_financeira cf ON cf.id = l.idconta_financeira
             LEFT JOIN cliente cl ON cl.id = l.idcliente
             {WHERE}
             ORDER BY
                CASE WHEN l.status IN ('aberto','parcial') THEN 0 ELSE 1 END,
                l.vencimento ASC, l.id DESC
             LIMIT $8 OFFSET $9"
        ))
        .bind(filtro.tipo)
        .bind(filtro.status)
        .bind(filtro.vencidos)
        .bind(filtro.inicio)
        .bind(filtro.fim)
        .bind(filtro.idplano_conta)
        .bind(&filtro.busca)
        .bind(page.limit())
        .bind(page.offset())
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)?;

        Ok(Page::new(items, page, total))
    }

    async fn atualizar_lancamento(
        &self,
        id: i64,
        d: &AtualizaLancamento,
        log: NovoLog,
    ) -> Result<Lancamento, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let l = sqlx::query_as::<_, Lancamento>(&format!(
            "UPDATE lancamento SET
                descricao = COALESCE($2, descricao),
                idplano_conta = COALESCE($3, idplano_conta),
                idconta_financeira = COALESCE($4, idconta_financeira),
                favorecido = COALESCE($5, favorecido),
                documento = COALESCE($6, documento),
                vencimento = COALESCE($7, vencimento),
                competencia = COALESCE($8, competencia),
                observacao = COALESCE($9, observacao),
                atualizado_em = now()
             WHERE id = $1
               AND status IN ('aberto','parcial')
               AND ($10::bigint IS NULL OR version = $10)
             RETURNING {LANCAMENTO_COLS}"
        ))
        .bind(id)
        .bind(&d.descricao)
        .bind(d.idplano_conta)
        .bind(d.idconta_financeira)
        .bind(&d.favorecido)
        .bind(&d.documento)
        .bind(d.vencimento)
        .bind(d.competencia)
        .bind(&d.observacao)
        .bind(d.version)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| {
            DomainError::conflito(
                "Lançamento indisponível para edição (liquidado/cancelado ou alterado por outro usuário).",
            )
        })?;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(l)
    }

    async fn cancelar_lancamento(&self, id: i64, log: NovoLog) -> Result<Lancamento, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let l = sqlx::query_as::<_, Lancamento>(&format!(
            "UPDATE lancamento SET status = 'cancelado', atualizado_em = now()
             WHERE id = $1 AND status IN ('aberto','parcial')
             RETURNING {LANCAMENTO_COLS}"
        ))
        .bind(id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| {
            DomainError::regra("Só é possível cancelar títulos em aberto ou parciais.")
        })?;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(l)
    }

    async fn remover_lancamento(&self, id: i64, log: NovoLog) -> Result<(), DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let r = sqlx::query(
            "DELETE FROM lancamento WHERE id = $1
               AND status = 'aberto' AND valor_liquidado = 0",
        )
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(|e| map_del_err(e, "Lançamento possui vínculos."))?;
        if r.rows_affected() == 0 {
            return Err(DomainError::regra(
                "Só é possível excluir títulos em aberto sem baixas — cancele-os.",
            ));
        }
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(())
    }

    // =======================================================================
    // baixas — tx única: evento + saldo do título + split IBS/CBS
    // =======================================================================

    async fn baixar(
        &self,
        baixa: &NovaBaixa,
        idfuncionario: i64,
        log: NovoLog,
    ) -> Result<(BaixaLancamento, Lancamento), DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;

        // trava a linha do título — duas baixas simultâneas não podem furar o saldo
        let lanc = sqlx::query_as::<_, Lancamento>(&format!(
            "SELECT {LANCAMENTO_COLS} FROM lancamento WHERE id = $1 FOR UPDATE"
        ))
        .bind(baixa.idlancamento)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| DomainError::nao_encontrado("Lançamento não encontrado."))?;

        if !lanc.status.liquido_aberto() {
            return Err(DomainError::regra(
                "Título já liquidado ou cancelado — não admite baixas.",
            ));
        }
        let saldo = lanc.saldo_aberto();
        if baixa.valor > saldo {
            return Err(DomainError::regra(format!(
                "Baixa excede o saldo aberto ({}).",
                saldo
            )));
        }

        let b = sqlx::query_as::<_, BaixaLancamento>(&format!(
            "INSERT INTO baixa_lancamento
                (idlancamento, idconta_financeira, valor, data, idforma_pagamento,
                 observacao, idfuncionario)
             VALUES ($1, $2, $3, COALESCE($4, CURRENT_DATE), $5, $6, $7)
             RETURNING {BAIXA_COLS}"
        ))
        .bind(baixa.idlancamento)
        .bind(baixa.idconta_financeira)
        .bind(baixa.valor)
        .bind(baixa.data)
        .bind(baixa.idforma_pagamento)
        .bind(&baixa.observacao)
        .bind(idfuncionario)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;

        // status derivado do novo saldo — nunca escrito à mão fora daqui
        let l = sqlx::query_as::<_, Lancamento>(&format!(
            "UPDATE lancamento SET
                valor_liquidado = valor_liquidado + $2,
                status = CASE
                    WHEN valor_liquidado + $2 >= valor THEN 'liquidado'
                    ELSE 'parcial'
                END::lancamento_status,
                atualizado_em = now()
             WHERE id = $1
             RETURNING {LANCAMENTO_COLS}"
        ))
        .bind(lanc.id)
        .bind(baixa.valor)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;

        // split payment IBS/CBS — só sobre entradas (receber)
        if lanc.tipo == TipoLancamento::Receber {
            provisionar_split_baixa(&mut tx, b.id).await?;
        }

        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok((b, l))
    }

    async fn listar_baixas(&self, idlancamento: i64) -> Result<Vec<BaixaView>, DomainError> {
        sqlx::query_as::<_, BaixaView>(
            "SELECT b.id, b.idlancamento, b.idconta_financeira, cf.nome AS conta_financeira,
                    b.valor, b.data, b.idforma_pagamento, fp.nome AS forma_pagamento,
                    b.observacao, f.nome AS funcionario, b.criado_em
             FROM baixa_lancamento b
             LEFT JOIN conta_financeira cf ON cf.id = b.idconta_financeira
             LEFT JOIN forma_pagamento fp ON fp.id = b.idforma_pagamento
             LEFT JOIN funcionario f ON f.id = b.idfuncionario
             WHERE b.idlancamento = $1
             ORDER BY b.data, b.id",
        )
        .bind(idlancamento)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    // =======================================================================
    // fluxo de caixa diário — regime de caixa + projeção de vencimentos
    // =======================================================================

    async fn fluxo_caixa(&self, periodo: PeriodoEstadia) -> Result<FluxoCaixa, DomainError> {
        #[derive(sqlx::FromRow)]
        struct DiaRow {
            data: NaiveDate,
            entradas: Decimal,
            saidas: Decimal,
            prev_entradas: Decimal,
            prev_saidas: Decimal,
        }

        // saldo de abertura = saldos iniciais das contas ativas + tudo que já
        // movimentou antes do período (baixas + consumos fechados − reembolsos)
        let abertura = sqlx::query_scalar::<_, Decimal>(
            "SELECT
                COALESCE((SELECT SUM(saldo_inicial) FROM conta_financeira WHERE ativo), 0)
              + COALESCE((
                  SELECT SUM(b.valor) FROM baixa_lancamento b
                  JOIN lancamento l ON l.id = b.idlancamento
                  WHERE l.tipo = 'receber' AND l.status != 'cancelado' AND b.data < $1), 0)
              + COALESCE((
                  SELECT SUM(c.valor_final) FROM consumo c
                  WHERE c.status = 'concluido' AND c.fechado_em::date < $1), 0)
              - COALESCE((
                  SELECT SUM(b.valor) FROM baixa_lancamento b
                  JOIN lancamento l ON l.id = b.idlancamento
                  WHERE l.tipo = 'pagar' AND l.status != 'cancelado' AND b.data < $1), 0)
              - COALESCE((
                  SELECT SUM(r.valor) FROM reembolso r
                  WHERE r.criado_em::date < $1), 0)",
        )
        .bind(periodo.entrada)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)?;

        let rows = sqlx::query_as::<_, DiaRow>(
            "SELECT d.dia::date AS data,
                    COALESCE(e.valor, 0) AS entradas,
                    COALESCE(s.valor, 0) AS saidas,
                    COALESCE(pe.valor, 0) AS prev_entradas,
                    COALESCE(ps.valor, 0) AS prev_saidas
             FROM generate_series($1::date, $2::date, '1 day') d(dia)
             LEFT JOIN (
                SELECT data, SUM(valor) AS valor FROM (
                    SELECT b.data, b.valor FROM baixa_lancamento b
                    JOIN lancamento l ON l.id = b.idlancamento
                    WHERE l.tipo = 'receber' AND l.status != 'cancelado'
                    UNION ALL
                    SELECT c.fechado_em::date, c.valor_final FROM consumo c
                    WHERE c.status = 'concluido'
                ) x WHERE data BETWEEN $1 AND $2 GROUP BY data
             ) e ON e.data = d.dia
             LEFT JOIN (
                SELECT data, SUM(valor) AS valor FROM (
                    SELECT b.data, b.valor FROM baixa_lancamento b
                    JOIN lancamento l ON l.id = b.idlancamento
                    WHERE l.tipo = 'pagar' AND l.status != 'cancelado'
                    UNION ALL
                    SELECT r.criado_em::date, r.valor FROM reembolso r
                ) x WHERE data BETWEEN $1 AND $2 GROUP BY data
             ) s ON s.data = d.dia
             LEFT JOIN (
                SELECT vencimento AS data, SUM(valor - valor_liquidado) AS valor
                FROM lancamento
                WHERE tipo = 'receber' AND status IN ('aberto','parcial')
                  AND vencimento BETWEEN $1 AND $2
                GROUP BY vencimento
             ) pe ON pe.data = d.dia
             LEFT JOIN (
                SELECT vencimento AS data, SUM(valor - valor_liquidado) AS valor
                FROM lancamento
                WHERE tipo = 'pagar' AND status IN ('aberto','parcial')
                  AND vencimento BETWEEN $1 AND $2
                GROUP BY vencimento
             ) ps ON ps.data = d.dia
             ORDER BY d.dia",
        )
        .bind(periodo.entrada)
        .bind(periodo.saida)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)?;

        let mut acumulado = abertura;
        let mut total_entradas = Decimal::ZERO;
        let mut total_saidas = Decimal::ZERO;
        let mut total_prev_e = Decimal::ZERO;
        let mut total_prev_s = Decimal::ZERO;
        let dias = rows
            .into_iter()
            .map(|r| {
                acumulado += r.entradas - r.saidas;
                total_entradas += r.entradas;
                total_saidas += r.saidas;
                total_prev_e += r.prev_entradas;
                total_prev_s += r.prev_saidas;
                FluxoCaixaDia {
                    data: r.data,
                    entradas: r.entradas,
                    saidas: r.saidas,
                    saldo: r.entradas - r.saidas,
                    acumulado,
                    prev_entradas: r.prev_entradas,
                    prev_saidas: r.prev_saidas,
                }
            })
            .collect();

        Ok(FluxoCaixa {
            inicio: periodo.entrada,
            fim: periodo.saida,
            saldo_abertura: abertura,
            total_entradas,
            total_saidas,
            saldo_final_previsto: abertura + total_entradas - total_saidas + total_prev_e
                - total_prev_s,
            dias,
        })
    }

    // =======================================================================
    // DRE — regime de competência (COALESCE(competencia, vencimento))
    // =======================================================================

    async fn dre(&self, periodo: PeriodoEstadia) -> Result<Dre, DomainError> {
        use clarituz_domain::enums::GrupoDre as G;

        // totais por grupo: deduções/custos/despesas positivos;
        // resultado_financeiro e outras assinados pelo tipo do lançamento
        #[derive(sqlx::FromRow)]
        struct GrupoRow {
            grupo_dre: clarituz_domain::enums::GrupoDre,
            valor: Decimal,
        }
        // linhas por conta do plano (detalhamento)
        #[derive(sqlx::FromRow)]
        struct LinhaRow {
            codigo: String,
            nome: String,
            grupo_dre: clarituz_domain::enums::GrupoDre,
            tipo: TipoLancamento,
            valor: Decimal,
        }

        // receita operacional: contas de consumo fechadas no período
        let (rec_operacional, descontos) = sqlx::query_as::<_, (Decimal, Decimal)>(
            "SELECT COALESCE(SUM(valor_final), 0), COALESCE(SUM(total_desconto), 0)
             FROM consumo
             WHERE status = 'concluido' AND fechado_em::date BETWEEN $1 AND $2",
        )
        .bind(periodo.entrada)
        .bind(periodo.saida)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)?;

        // tributos provisionados na competência (IBS/CBS do split payment)
        let (ibs, cbs) = sqlx::query_as::<_, (Decimal, Decimal)>(
            "SELECT COALESCE(SUM(valor_ibs), 0), COALESCE(SUM(valor_cbs), 0)
             FROM split_payment
             WHERE competencia BETWEEN $1 AND $2",
        )
        .bind(periodo.entrada)
        .bind(periodo.saida)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)?;

        let grupos = sqlx::query_as::<_, GrupoRow>(
            "SELECT pc.grupo_dre,
                    SUM(CASE WHEN pc.grupo_dre IN ('resultado_financeiro','outras')
                              AND l.tipo = 'pagar' THEN -l.valor ELSE l.valor END) AS valor
             FROM lancamento l JOIN plano_conta pc ON pc.id = l.idplano_conta
             WHERE l.status != 'cancelado'
               AND COALESCE(l.competencia, l.vencimento) BETWEEN $1 AND $2
             GROUP BY pc.grupo_dre",
        )
        .bind(periodo.entrada)
        .bind(periodo.saida)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)?;

        let linha_rows = sqlx::query_as::<_, LinhaRow>(
            "SELECT pc.codigo, pc.nome, pc.grupo_dre, l.tipo, SUM(l.valor) AS valor
             FROM lancamento l JOIN plano_conta pc ON pc.id = l.idplano_conta
             WHERE l.status != 'cancelado'
               AND COALESCE(l.competencia, l.vencimento) BETWEEN $1 AND $2
             GROUP BY pc.id, pc.codigo, pc.nome, pc.grupo_dre, l.tipo
             ORDER BY pc.codigo",
        )
        .bind(periodo.entrada)
        .bind(periodo.saida)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)?;

        // lançamentos sem plano de contas → caem em "outras" (assinado)
        let nao_classificado = sqlx::query_scalar::<_, Decimal>(
            "SELECT COALESCE(SUM(CASE WHEN tipo = 'receber' THEN valor ELSE -valor END), 0)
             FROM lancamento
             WHERE idplano_conta IS NULL AND status != 'cancelado'
               AND COALESCE(competencia, vencimento) BETWEEN $1 AND $2",
        )
        .bind(periodo.entrada)
        .bind(periodo.saida)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)?;

        let de = |g: G| -> Decimal {
            grupos
                .iter()
                .find(|r| r.grupo_dre == g)
                .map_or(Decimal::ZERO, |r| r.valor)
        };

        let receita_bruta = rec_operacional + de(G::ReceitaBruta);
        let deducoes = descontos + ibs + cbs + de(G::Deducoes);
        let receita_liquida = receita_bruta - deducoes;
        let custos = de(G::Custos);
        let despesas = de(G::DespesasOperacionais);
        let lucro_operacional = receita_liquida - custos - despesas;
        let resultado_financeiro = de(G::ResultadoFinanceiro);
        let outras = de(G::Outras) + nao_classificado;
        let resultado_liquido = lucro_operacional + resultado_financeiro + outras;

        // detalhamento: linhas operacionais primeiro, depois plano de contas
        let mut linhas = Vec::new();
        if rec_operacional > Decimal::ZERO {
            linhas.push(DreLinha {
                origem: "operacional".into(),
                codigo: None,
                rotulo: "Receita operacional (reservas e consumo)".into(),
                grupo: G::ReceitaBruta,
                valor: rec_operacional,
            });
        }
        if descontos > Decimal::ZERO {
            linhas.push(DreLinha {
                origem: "operacional".into(),
                codigo: None,
                rotulo: "Descontos concedidos".into(),
                grupo: G::Deducoes,
                valor: descontos,
            });
        }
        if ibs > Decimal::ZERO {
            linhas.push(DreLinha {
                origem: "operacional".into(),
                codigo: None,
                rotulo: "IBS — Imposto sobre Bens e Serviços".into(),
                grupo: G::Deducoes,
                valor: ibs,
            });
        }
        if cbs > Decimal::ZERO {
            linhas.push(DreLinha {
                origem: "operacional".into(),
                codigo: None,
                rotulo: "CBS — Contribuição sobre Bens e Serviços".into(),
                grupo: G::Deducoes,
                valor: cbs,
            });
        }
        linhas.extend(linha_rows.into_iter().map(|r| DreLinha {
            origem: "plano_conta".into(),
            codigo: Some(r.codigo),
            rotulo: r.nome,
            grupo: r.grupo_dre,
            valor: match (r.grupo_dre, r.tipo) {
                (G::ResultadoFinanceiro | G::Outras, TipoLancamento::Pagar) => -r.valor,
                _ => r.valor,
            },
        }));
        if nao_classificado != Decimal::ZERO {
            linhas.push(DreLinha {
                origem: "operacional".into(),
                codigo: None,
                rotulo: "Lançamentos não classificados".into(),
                grupo: G::Outras,
                valor: nao_classificado,
            });
        }

        Ok(Dre {
            inicio: periodo.entrada,
            fim: periodo.saida,
            receita_bruta,
            deducoes,
            receita_liquida,
            custos,
            despesas_operacionais: despesas,
            lucro_operacional,
            resultado_financeiro,
            outras,
            resultado_liquido,
            ibs,
            cbs,
            linhas,
        })
    }

    // =======================================================================
    // extrato bancário / conciliação
    // =======================================================================

    async fn importar_extrato(
        &self,
        itens: &[NovoExtratoItem],
    ) -> Result<ImportacaoExtrato, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let mut importados = 0i64;
        let mut duplicados = 0i64;
        for i in itens {
            let r = sqlx::query(
                "INSERT INTO extrato_item
                    (idconta_financeira, data, descricao, documento, valor, fit_id, origem)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 ON CONFLICT (idconta_financeira, fit_id)
                     WHERE fit_id IS NOT NULL
                 DO NOTHING",
            )
            .bind(i.idconta_financeira)
            .bind(i.data)
            .bind(&i.descricao)
            .bind(&i.documento)
            .bind(i.valor)
            .bind(&i.fit_id)
            .bind(&i.origem)
            .execute(&mut *tx)
            .await
            .map_err(map_db_err)?;
            if r.rows_affected() > 0 {
                importados += 1;
            } else {
                duplicados += 1;
            }
        }
        tx.commit().await.map_err(map_db_err)?;
        Ok(ImportacaoExtrato {
            importados,
            duplicados,
        })
    }

    async fn listar_extrato(
        &self,
        filtro: &FiltroExtrato,
        page: PageParams,
    ) -> Result<Page<ExtratoView>, DomainError> {
        const WHERE: &str = "
            WHERE ($1::bigint IS NULL OR e.idconta_financeira = $1)
              AND ($2::extrato_status IS NULL OR e.status = $2)
              AND ($3::date IS NULL OR e.data >= $3)
              AND ($4::date IS NULL OR e.data <= $4)";

        let total =
            sqlx::query_scalar::<_, i64>(&format!("SELECT COUNT(*) FROM extrato_item e {WHERE}"))
                .bind(filtro.idconta_financeira)
                .bind(filtro.status)
                .bind(filtro.inicio)
                .bind(filtro.fim)
                .fetch_one(&self.pool)
                .await
                .map_err(map_db_err)?;

        let items = sqlx::query_as::<_, ExtratoView>(&format!(
            "SELECT e.id, e.idconta_financeira, cf.nome AS conta_financeira,
                    e.data, e.descricao, e.documento, e.valor, e.fit_id, e.origem,
                    e.status, e.idbaixa,
                    (SELECT MAX(100 - 12 * ABS(b.data - e.data)::numeric)
                       FROM baixa_lancamento b
                       JOIN lancamento l ON l.id = b.idlancamento
                       WHERE b.idconta_financeira = e.idconta_financeira
                         AND ABS(b.data - e.data) <= 7
                         AND ABS(b.valor - ABS(e.valor))
                             <= GREATEST(2.00, ABS(e.valor) * 0.05)
                         AND l.tipo = CASE WHEN e.valor > 0
                                          THEN 'receber'::lancamento_tipo
                                          ELSE 'pagar'::lancamento_tipo END
                         AND l.status != 'cancelado'
                         AND NOT EXISTS (
                            SELECT 1 FROM conciliacao cc WHERE cc.idbaixa = b.id)
                    ) AS melhor_score,
                    e.importado_em
             FROM extrato_item e
             LEFT JOIN conta_financeira cf ON cf.id = e.idconta_financeira
             {WHERE}
             ORDER BY
                CASE e.status WHEN 'pendente' THEN 0 ELSE 1 END,
                e.data DESC, e.id DESC
             LIMIT $5 OFFSET $6"
        ))
        .bind(filtro.idconta_financeira)
        .bind(filtro.status)
        .bind(filtro.inicio)
        .bind(filtro.fim)
        .bind(page.limit())
        .bind(page.offset())
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)?;

        Ok(Page::new(items, page, total))
    }

    async fn resumo_extrato(
        &self,
        idconta_financeira: Option<i64>,
    ) -> Result<ConciliacaoResumo, DomainError> {
        sqlx::query_as::<_, ConciliacaoResumo>(
            "SELECT
                COUNT(*) FILTER (WHERE status = 'pendente')   AS pendentes,
                COUNT(*) FILTER (WHERE status = 'conciliado') AS conciliados,
                COUNT(*) FILTER (WHERE status = 'ignorado')   AS ignorados,
                MAX(data) FILTER (WHERE status != 'ignorado') AS coberto_ate
             FROM extrato_item
             WHERE ($1::bigint IS NULL OR idconta_financeira = $1)",
        )
        .bind(idconta_financeira)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn buscar_extrato(&self, id: i64) -> Result<Option<ExtratoItem>, DomainError> {
        sqlx::query_as::<_, ExtratoItem>(
            "SELECT id, idconta_financeira, data, descricao, documento, valor,
                    fit_id, origem, status, idbaixa, importado_em
             FROM extrato_item WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn ignorar_extrato(&self, id: i64, log: NovoLog) -> Result<(), DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let r = sqlx::query(
            "UPDATE extrato_item SET status = 'ignorado'
             WHERE id = $1 AND status = 'pendente'",
        )
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(map_db_err)?;
        if r.rows_affected() == 0 {
            return Err(DomainError::regra(
                "Só é possível ignorar itens pendentes de conciliação.",
            ));
        }
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(())
    }

    async fn sugestoes_extrato(
        &self,
        id: i64,
        janela_dias: i64,
    ) -> Result<Vec<SugestaoConciliacao>, DomainError> {
        #[derive(sqlx::FromRow)]
        struct CandRow {
            // BaixaView embutido por prefixo
            id: i64,
            idlancamento: i64,
            idconta_financeira: i64,
            conta_financeira: Option<String>,
            valor: Decimal,
            data: NaiveDate,
            idforma_pagamento: Option<i64>,
            forma_pagamento: Option<String>,
            observacao: Option<String>,
            funcionario: Option<String>,
            criado_em: chrono::DateTime<chrono::Utc>,
            lancamento_descricao: String,
            lancamento_tipo: TipoLancamento,
            dias: i64,
        }

        let Some(e) = self.buscar_extrato(id).await? else {
            return Err(DomainError::nao_encontrado(
                "Item de extrato não encontrado.",
            ));
        };

        let candidatos = sqlx::query_as::<_, CandRow>(
            "SELECT b.id, b.idlancamento, b.idconta_financeira,
                    cf.nome AS conta_financeira, b.valor, b.data,
                    b.idforma_pagamento, fp.nome AS forma_pagamento,
                    b.observacao, f.nome AS funcionario, b.criado_em,
                    l.descricao AS lancamento_descricao, l.tipo AS lancamento_tipo,
                    ABS(b.data - $2) AS dias
             FROM baixa_lancamento b
             JOIN lancamento l ON l.id = b.idlancamento
             LEFT JOIN conta_financeira cf ON cf.id = b.idconta_financeira
             LEFT JOIN forma_pagamento fp ON fp.id = b.idforma_pagamento
             LEFT JOIN funcionario f ON f.id = b.idfuncionario
             WHERE b.idconta_financeira = $3
               AND ABS(b.data - $2) <= $4
               AND ABS(b.valor - $5) <= GREATEST(2.00, $5 * 0.05)
               AND l.tipo = $6
               AND l.status != 'cancelado'
               AND NOT EXISTS (SELECT 1 FROM conciliacao c WHERE c.idbaixa = b.id)
             ORDER BY dias, ABS(b.valor - $5)
             LIMIT 10",
        )
        .bind(id)
        .bind(e.data)
        .bind(e.idconta_financeira)
        .bind(janela_dias.clamp(1, 30))
        .bind(e.valor.abs())
        .bind(if e.valor > Decimal::ZERO {
            TipoLancamento::Receber
        } else {
            TipoLancamento::Pagar
        })
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)?;

        // tokens da descrição do extrato para o bônus de similaridade
        let tokens = |s: &str| -> HashSet<String> {
            s.to_lowercase()
                .split(|c: char| !c.is_alphanumeric())
                .filter(|t| t.len() >= 4)
                .map(str::to_string)
                .collect()
        };
        let desc_tokens = tokens(&e.descricao);

        let mut sugestoes: Vec<SugestaoConciliacao> = candidatos
            .into_iter()
            .map(|c| {
                let alvo = e.valor.abs();
                let diff_pct = if alvo > Decimal::ZERO {
                    ((c.valor - alvo).abs() / alvo * Decimal::from(100)).min(Decimal::from(100))
                } else {
                    Decimal::ZERO
                };
                let overlap = tokens(&format!(
                    "{} {}",
                    c.lancamento_descricao,
                    c.funcionario.clone().unwrap_or_default()
                ));
                let desc_pen = if desc_tokens.is_empty() || !desc_tokens.is_disjoint(&overlap) {
                    Decimal::ZERO
                } else {
                    Decimal::from(10)
                };
                // 100 − distância temporal − divergência de valor − descrição
                let score = Decimal::from(100)
                    - Decimal::from(c.dias.min(5)) * Decimal::from(12)
                    - (diff_pct * Decimal::from(2)).min(Decimal::from(25))
                    - desc_pen;
                SugestaoConciliacao {
                    baixa: BaixaView {
                        id: c.id,
                        idlancamento: c.idlancamento,
                        idconta_financeira: c.idconta_financeira,
                        conta_financeira: c.conta_financeira,
                        valor: c.valor,
                        data: c.data,
                        idforma_pagamento: c.idforma_pagamento,
                        forma_pagamento: c.forma_pagamento,
                        observacao: c.observacao,
                        funcionario: c.funcionario,
                        criado_em: c.criado_em,
                    },
                    score,
                    dias_diferenca: c.dias,
                    lancamento_descricao: c.lancamento_descricao,
                    lancamento_tipo: c.lancamento_tipo,
                }
            })
            .filter(|s| s.score >= Decimal::from(45))
            .collect();
        sugestoes.sort_by_key(|s| std::cmp::Reverse(s.score));
        sugestoes.truncate(5);
        Ok(sugestoes)
    }

    async fn conciliar(
        &self,
        idextrato: i64,
        idbaixa: i64,
        tipo: &str,
        score: Decimal,
        log: NovoLog,
    ) -> Result<Conciliacao, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;

        // valida as duas pontas antes de gravar o match
        let e_pendente: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM extrato_item WHERE id = $1 AND status = 'pendente')",
        )
        .bind(idextrato)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;
        if !e_pendente {
            return Err(DomainError::regra(
                "Item de extrato não está pendente de conciliação.",
            ));
        }
        let b_livre: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM baixa_lancamento WHERE id = $1)
               AND NOT EXISTS(SELECT 1 FROM conciliacao WHERE idbaixa = $1)",
        )
        .bind(idbaixa)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;
        if !b_livre {
            return Err(DomainError::conflito(
                "Baixa inexistente ou já conciliada com outro item de extrato.",
            ));
        }

        let c = sqlx::query_as::<_, Conciliacao>(
            "INSERT INTO conciliacao (idextrato_item, idbaixa, score, tipo, idfuncionario)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, idextrato_item, idbaixa, score, tipo, idfuncionario, criado_em",
        )
        .bind(idextrato)
        .bind(idbaixa)
        .bind(score)
        .bind(tipo)
        .bind(log.idfuncionario)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;

        sqlx::query("UPDATE extrato_item SET status = 'conciliado', idbaixa = $2 WHERE id = $1")
            .bind(idextrato)
            .bind(idbaixa)
            .execute(&mut *tx)
            .await
            .map_err(map_db_err)?;

        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(c)
    }

    async fn desconciliar(&self, idconciliacao: i64, log: NovoLog) -> Result<(), DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let c = sqlx::query_as::<_, (i64, i64)>(
            "DELETE FROM conciliacao WHERE id = $1 RETURNING idextrato_item, idbaixa",
        )
        .bind(idconciliacao)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| DomainError::nao_encontrado("Conciliação não encontrada."))?;
        sqlx::query("UPDATE extrato_item SET status = 'pendente', idbaixa = NULL WHERE id = $1")
            .bind(c.0)
            .execute(&mut *tx)
            .await
            .map_err(map_db_err)?;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(())
    }

    async fn auto_conciliar(
        &self,
        idconta_financeira: i64,
        idfuncionario: i64,
        log: NovoLog,
    ) -> Result<u64, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;

        // pareamento 1:1 valor+data exatos — row_number evita que duas baixas
        // idênticas concorram pelo mesmo item de extrato
        let pares = sqlx::query_as::<_, (i64, i64)>(
            "WITH cand_e AS (
                SELECT e.id, e.data, ABS(e.valor) AS v,
                       CASE WHEN e.valor > 0 THEN 'receber'::lancamento_tipo
                            ELSE 'pagar'::lancamento_tipo END AS tipo,
                       ROW_NUMBER() OVER (PARTITION BY e.data, ABS(e.valor)
                                          ORDER BY e.id) AS rn
                FROM extrato_item e
                WHERE e.idconta_financeira = $1 AND e.status = 'pendente'
             ), cand_b AS (
                SELECT b.id, b.data, b.valor, l.tipo,
                       ROW_NUMBER() OVER (PARTITION BY b.data, b.valor
                                          ORDER BY b.id) AS rn
                FROM baixa_lancamento b
                JOIN lancamento l ON l.id = b.idlancamento
                WHERE b.idconta_financeira = $1
                  AND l.status != 'cancelado'
                  AND NOT EXISTS (SELECT 1 FROM conciliacao c WHERE c.idbaixa = b.id)
             )
             SELECT e.id, b.id
             FROM cand_e e
             JOIN cand_b b ON b.data = e.data AND b.valor = e.v
                          AND b.rn = e.rn AND b.tipo = e.tipo",
        )
        .bind(idconta_financeira)
        .fetch_all(&mut *tx)
        .await
        .map_err(map_db_err)?;

        let mut n = 0u64;
        for (idextrato, idbaixa) in pares {
            sqlx::query(
                "INSERT INTO conciliacao (idextrato_item, idbaixa, score, tipo, idfuncionario)
                 VALUES ($1, $2, 100, 'exato', $3)",
            )
            .bind(idextrato)
            .bind(idbaixa)
            .bind(idfuncionario)
            .execute(&mut *tx)
            .await
            .map_err(map_db_err)?;
            sqlx::query(
                "UPDATE extrato_item SET status = 'conciliado', idbaixa = $2 WHERE id = $1",
            )
            .bind(idextrato)
            .bind(idbaixa)
            .execute(&mut *tx)
            .await
            .map_err(map_db_err)?;
            n += 1;
        }

        if n > 0 {
            audit::gravar(&mut *tx, &log).await?;
        }
        tx.commit().await.map_err(map_db_err)?;
        Ok(n)
    }

    async fn classificar_extrato(
        &self,
        idextrato: i64,
        idplano_conta: i64,
        descricao: Option<String>,
        idfuncionario: i64,
        log: NovoLog,
    ) -> Result<Lancamento, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;

        let e = sqlx::query_as::<_, ExtratoItem>(
            "SELECT id, idconta_financeira, data, descricao, documento, valor,
                    fit_id, origem, status, idbaixa, importado_em
             FROM extrato_item WHERE id = $1 FOR UPDATE",
        )
        .bind(idextrato)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| DomainError::nao_encontrado("Item de extrato não encontrado."))?;

        if e.status != StatusExtrato::Pendente {
            return Err(DomainError::regra(
                "Item de extrato já foi conciliado ou ignorado.",
            ));
        }

        // sinal do extrato manda no tipo — é a verdade do caixa
        let (tipo, valor) = if e.valor > Decimal::ZERO {
            (TipoLancamento::Receber, e.valor)
        } else {
            (TipoLancamento::Pagar, -e.valor)
        };
        let descricao = descricao
            .filter(|d| !d.trim().is_empty())
            .unwrap_or_else(|| e.descricao.clone());

        let l = sqlx::query_as::<_, Lancamento>(&format!(
            "INSERT INTO lancamento
                (tipo, descricao, idplano_conta, idconta_financeira, documento,
                 valor, valor_liquidado, emissao, vencimento, competencia,
                 status, observacao, idfuncionario)
             VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $7, $7, 'liquidado', $8, $9)
             RETURNING {LANCAMENTO_COLS}"
        ))
        .bind(tipo)
        .bind(&descricao)
        .bind(idplano_conta)
        .bind(e.idconta_financeira)
        .bind(&e.documento)
        .bind(valor)
        .bind(e.data)
        .bind(format!("Classificado do extrato Nº{}", e.id))
        .bind(idfuncionario)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;

        let b = sqlx::query_as::<_, BaixaLancamento>(&format!(
            "INSERT INTO baixa_lancamento
                (idlancamento, idconta_financeira, valor, data, idfuncionario, observacao)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING {BAIXA_COLS}"
        ))
        .bind(l.id)
        .bind(e.idconta_financeira)
        .bind(valor)
        .bind(e.data)
        .bind(idfuncionario)
        .bind(format!("Conciliado de extrato Nº{}", e.id))
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;

        sqlx::query(
            "INSERT INTO conciliacao (idextrato_item, idbaixa, score, tipo, idfuncionario)
             VALUES ($1, $2, 100, 'classificado', $3)",
        )
        .bind(e.id)
        .bind(b.id)
        .bind(idfuncionario)
        .execute(&mut *tx)
        .await
        .map_err(map_db_err)?;

        sqlx::query("UPDATE extrato_item SET status = 'conciliado', idbaixa = $2 WHERE id = $1")
            .bind(e.id)
            .bind(b.id)
            .execute(&mut *tx)
            .await
            .map_err(map_db_err)?;

        // receita classificada do extrato também gera split
        if tipo == TipoLancamento::Receber {
            provisionar_split_baixa(&mut tx, b.id).await?;
        }

        let mut log = log;
        log.idtabela = l.id;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(l)
    }

    // =======================================================================
    // tributos / split payment IBS-CBS
    // =======================================================================

    async fn tributo_config_vigente(
        &self,
        data: NaiveDate,
    ) -> Result<Option<TributoConfig>, DomainError> {
        sqlx::query_as::<_, TributoConfig>(
            "SELECT id, aliq_ibs, aliq_cbs, regime, vigente_desde, idfuncionario, criado_em
             FROM tributo_config
             WHERE vigente_desde <= $1
             ORDER BY vigente_desde DESC LIMIT 1",
        )
        .bind(data)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn listar_tributo_configs(&self) -> Result<Vec<TributoConfig>, DomainError> {
        sqlx::query_as::<_, TributoConfig>(
            "SELECT id, aliq_ibs, aliq_cbs, regime, vigente_desde, idfuncionario, criado_em
             FROM tributo_config ORDER BY vigente_desde DESC",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn criar_tributo_config(
        &self,
        nova: &NovaTributoConfig,
        log: NovoLog,
    ) -> Result<TributoConfig, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let t = sqlx::query_as::<_, TributoConfig>(
            "INSERT INTO tributo_config (aliq_ibs, aliq_cbs, regime, vigente_desde, idfuncionario)
             VALUES ($1, $2, $3, COALESCE($4, CURRENT_DATE), $5)
             RETURNING id, aliq_ibs, aliq_cbs, regime, vigente_desde, idfuncionario, criado_em",
        )
        .bind(nova.aliq_ibs)
        .bind(nova.aliq_cbs)
        .bind(&nova.regime)
        .bind(nova.vigente_desde)
        .bind(log.idfuncionario)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(t)
    }

    async fn provisionar_splits(&self) -> Result<u64, DomainError> {
        let mut n = 0u64;

        // consumos concluídos — pula reserva já provisionada via baixa do
        // lançamento vinculado (dedup de origem cruzada)
        let r1 = sqlx::query(
            "INSERT INTO split_payment
                (origem, idorigem, base, aliq_ibs, aliq_cbs, valor_ibs, valor_cbs,
                 valor_liquido, competencia)
             SELECT 'consumo', c.id, c.valor_final, t.aliq_ibs, t.aliq_cbs,
                    ROUND(c.valor_final * t.aliq_ibs / 100, 2),
                    ROUND(c.valor_final * t.aliq_cbs / 100, 2),
                    c.valor_final - ROUND(c.valor_final * t.aliq_ibs / 100, 2)
                           - ROUND(c.valor_final * t.aliq_cbs / 100, 2),
                    date_trunc('month', c.fechado_em)::date
             FROM consumo c
             JOIN LATERAL (
                SELECT aliq_ibs, aliq_cbs FROM tributo_config
                WHERE vigente_desde <= c.fechado_em::date
                ORDER BY vigente_desde DESC LIMIT 1
             ) t ON true
             WHERE c.status = 'concluido'
               AND NOT EXISTS (
                    SELECT 1 FROM lancamento l
                    JOIN baixa_lancamento b ON b.idlancamento = l.id
                    JOIN split_payment sp ON sp.origem = 'baixa' AND sp.idorigem = b.id
                    WHERE l.idreserva = c.idreserva)
             ON CONFLICT (origem, idorigem) DO NOTHING",
        )
        .execute(&self.pool)
        .await
        .map_err(map_db_err)?;
        n += r1.rows_affected();

        // baixas de recebimento — mesma regra anti-duplicidade inversa
        let r2 = sqlx::query(
            "INSERT INTO split_payment
                (origem, idorigem, base, aliq_ibs, aliq_cbs, valor_ibs, valor_cbs,
                 valor_liquido, competencia)
             SELECT 'baixa', b.id, b.valor, t.aliq_ibs, t.aliq_cbs,
                    ROUND(b.valor * t.aliq_ibs / 100, 2),
                    ROUND(b.valor * t.aliq_cbs / 100, 2),
                    b.valor - ROUND(b.valor * t.aliq_ibs / 100, 2)
                           - ROUND(b.valor * t.aliq_cbs / 100, 2),
                    date_trunc('month', b.data)::date
             FROM baixa_lancamento b
             JOIN lancamento l ON l.id = b.idlancamento
             JOIN LATERAL (
                SELECT aliq_ibs, aliq_cbs FROM tributo_config
                WHERE vigente_desde <= b.data
                ORDER BY vigente_desde DESC LIMIT 1
             ) t ON true
             WHERE l.tipo = 'receber' AND l.status != 'cancelado'
               AND NOT (l.idreserva IS NOT NULL AND EXISTS (
                    SELECT 1 FROM consumo c
                    WHERE c.idreserva = l.idreserva AND c.status = 'concluido'))
             ON CONFLICT (origem, idorigem) DO NOTHING",
        )
        .execute(&self.pool)
        .await
        .map_err(map_db_err)?;
        n += r2.rows_affected();

        Ok(n)
    }

    async fn split_resumo(&self, periodo: PeriodoEstadia) -> Result<SplitResumo, DomainError> {
        #[derive(sqlx::FromRow)]
        struct ResumoRow {
            base: Decimal,
            valor_ibs: Decimal,
            valor_cbs: Decimal,
            valor_liquido: Decimal,
            qtd_eventos: i64,
            provisionado_ibs: Decimal,
            provisionado_cbs: Decimal,
        }
        let r = sqlx::query_as::<_, ResumoRow>(
            "SELECT
                COALESCE(SUM(base), 0) AS base,
                COALESCE(SUM(valor_ibs), 0) AS valor_ibs,
                COALESCE(SUM(valor_cbs), 0) AS valor_cbs,
                COALESCE(SUM(valor_liquido), 0) AS valor_liquido,
                COUNT(*) AS qtd_eventos,
                COALESCE(SUM(valor_ibs) FILTER (WHERE status != 'recolhido'), 0) AS provisionado_ibs,
                COALESCE(SUM(valor_cbs) FILTER (WHERE status != 'recolhido'), 0) AS provisionado_cbs
             FROM split_payment
             WHERE competencia BETWEEN $1 AND $2",
        )
        .bind(periodo.entrada)
        .bind(periodo.saida)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)?;

        Ok(SplitResumo {
            inicio: periodo.entrada,
            fim: periodo.saida,
            base: r.base,
            valor_ibs: r.valor_ibs,
            valor_cbs: r.valor_cbs,
            valor_liquido: r.valor_liquido,
            qtd_eventos: r.qtd_eventos,
            provisionado_ibs: r.provisionado_ibs,
            provisionado_cbs: r.provisionado_cbs,
        })
    }

    async fn split_eventos(
        &self,
        periodo: PeriodoEstadia,
        page: PageParams,
    ) -> Result<Page<SplitEventoView>, DomainError> {
        let total = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM split_payment WHERE competencia BETWEEN $1 AND $2",
        )
        .bind(periodo.entrada)
        .bind(periodo.saida)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)?;

        let items = sqlx::query_as::<_, SplitEventoView>(
            "SELECT sp.id, sp.origem, sp.idorigem,
                    COALESCE(
                        CASE WHEN sp.origem = 'consumo'
                             THEN 'Reserva Nº' || r.id || ' — ' || cl.nome
                             ELSE l.descricao END,
                        'Evento Nº' || sp.id) AS descricao,
                    sp.base, sp.aliq_ibs, sp.aliq_cbs,
                    sp.valor_ibs, sp.valor_cbs, sp.valor_liquido,
                    sp.competencia, sp.status, sp.criado_em
             FROM split_payment sp
             LEFT JOIN consumo c ON sp.origem = 'consumo' AND c.id = sp.idorigem
             LEFT JOIN reserva r ON r.id = c.idreserva
             LEFT JOIN cliente cl ON cl.id = r.idcliente
             LEFT JOIN baixa_lancamento b ON sp.origem = 'baixa' AND b.id = sp.idorigem
             LEFT JOIN lancamento l ON l.id = b.idlancamento
             WHERE sp.competencia BETWEEN $1 AND $2
             ORDER BY sp.id DESC
             LIMIT $3 OFFSET $4",
        )
        .bind(periodo.entrada)
        .bind(periodo.saida)
        .bind(page.limit())
        .bind(page.offset())
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)?;

        Ok(Page::new(items, page, total))
    }

    async fn listar_apuracoes(&self) -> Result<Vec<TributoApuracao>, DomainError> {
        sqlx::query_as::<_, TributoApuracao>(
            "SELECT id, competencia, valor_ibs, valor_cbs, status, recolhido_em,
                    idfuncionario, criado_em
             FROM tributo_apuracao ORDER BY competencia DESC",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn recolher_apuracao(
        &self,
        competencia: NaiveDate,
        idfuncionario: i64,
        log: NovoLog,
    ) -> Result<TributoApuracao, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;

        let (ibs, cbs) = sqlx::query_as::<_, (Decimal, Decimal)>(
            "SELECT COALESCE(SUM(valor_ibs), 0), COALESCE(SUM(valor_cbs), 0)
             FROM split_payment
             WHERE competencia = $1 AND status != 'recolhido'",
        )
        .bind(competencia)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;

        if ibs + cbs <= Decimal::ZERO {
            return Err(DomainError::regra(
                "Nenhum tributo provisionado nesta competência.",
            ));
        }

        let ap = sqlx::query_as::<_, TributoApuracao>(
            "INSERT INTO tributo_apuracao (competencia, valor_ibs, valor_cbs, idfuncionario)
             VALUES ($1, $2, $3, $4)
             RETURNING id, competencia, valor_ibs, valor_cbs, status, recolhido_em,
                       idfuncionario, criado_em",
        )
        .bind(competencia)
        .bind(ibs)
        .bind(cbs)
        .bind(idfuncionario)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;

        sqlx::query(
            "UPDATE split_payment SET status = 'recolhido'
             WHERE competencia = $1 AND status != 'recolhido'",
        )
        .bind(competencia)
        .execute(&mut *tx)
        .await
        .map_err(map_db_err)?;

        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(ap)
    }
}
