//! Repositório de pagamentos online — transações atômicas no padrão do
//! codebase: entidade + efeitos (tentativa, auditoria, reserva) num commit.
//!
//! A trilha `pagamento_auditoria` é imutável e separada do `log` geral:
//! responde "quem/o quê mudou o dinheiro" sem misturar domínios.

use crate::persistence::db::map_db_err;
use async_trait::async_trait;
use clarituz_domain::entities::{
    NovaAuditoriaPagamento, PagamentoOnline, ReembolsoPagamento, TentativaPagamento, WebhookEvento,
};
use clarituz_domain::enums::{StatusPagamento, StatusProcWebhook, StatusReembolso};
use clarituz_domain::ports::{
    FiltroPagamento, NovaTentativa, NovoEventoWebhook, NovoPagamento, PagamentoRepository,
    PagamentoView, ReceitaAcomodacao, ResumoFinanceiro,
};
use clarituz_domain::DomainError;
use clarituz_shared::{Page, PageParams};
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Clone)]
pub struct PgPagamentoRepository {
    pool: PgPool,
}

impl PgPagamentoRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

const PAGAMENTO_COLS: &str = "id, idreserva, tipo, status, valor_centavos, moeda,
    pi_id, metodo, paid_em, provedor, ambiente, idintegracao, criado_em, atualizado_em";

const TENTATIVA_COLS: &str =
    "id, idpagamento, session_id, session_url, status, expires_em, criado_em";

const REEMBOLSO_COLS: &str = "id, idpagamento, refund_id, valor_centavos, motivo,
    status, criado_em, atualizado_em";

const EVENTO_COLS: &str = "id, provedor, event_id, event_type, payload, idintegracao,
    status, tentativas, ultimo_erro, recebido_em, processado_em";

/// Trilha imutável do pagamento — sempre dentro da transação do chamador.
async fn auditar(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    a: &NovaAuditoriaPagamento,
) -> Result<(), DomainError> {
    sqlx::query(
        "INSERT INTO pagamento_auditoria (idpagamento, ator_tipo, ator_id, acao, dados)
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(a.idpagamento)
    .bind(a.ator_tipo)
    .bind(a.ator_id)
    .bind(a.acao)
    .bind(&a.dados)
    .execute(&mut **tx)
    .await
    .map_err(map_db_err)?;
    Ok(())
}

#[async_trait]
impl PagamentoRepository for PgPagamentoRepository {
    async fn buscar(&self, id: i64) -> Result<Option<PagamentoOnline>, DomainError> {
        sqlx::query_as::<_, PagamentoOnline>(&format!(
            "SELECT {PAGAMENTO_COLS} FROM pagamento WHERE id = $1"
        ))
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn buscar_por_pi(&self, pi_id: &str) -> Result<Option<PagamentoOnline>, DomainError> {
        sqlx::query_as::<_, PagamentoOnline>(&format!(
            "SELECT {PAGAMENTO_COLS} FROM pagamento WHERE pi_id = $1"
        ))
        .bind(pi_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn buscar_por_session(
        &self,
        session_id: &str,
    ) -> Result<Option<PagamentoOnline>, DomainError> {
        sqlx::query_as::<_, PagamentoOnline>(
            "SELECT p.* FROM pagamento p
             JOIN pagamento_tentativa t ON t.idpagamento = p.id
             WHERE t.session_id = $1",
        )
        .bind(session_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn listar_da_reserva(&self, idreserva: i64) -> Result<Vec<PagamentoOnline>, DomainError> {
        sqlx::query_as::<_, PagamentoOnline>(&format!(
            "SELECT {PAGAMENTO_COLS} FROM pagamento WHERE idreserva = $1
             ORDER BY criado_em DESC"
        ))
        .bind(idreserva)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn criar(&self, novo: &NovoPagamento) -> Result<PagamentoOnline, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let p = sqlx::query_as::<_, PagamentoOnline>(&format!(
            "INSERT INTO pagamento (idreserva, tipo, valor_centavos, provedor, ambiente, idintegracao)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING {PAGAMENTO_COLS}"
        ))
        .bind(novo.idreserva)
        .bind(novo.tipo)
        .bind(novo.valor_centavos)
        .bind(&novo.provedor)
        .bind(&novo.ambiente)
        .bind(novo.idintegracao)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;
        auditar(
            &mut tx,
            &NovaAuditoriaPagamento {
                idpagamento: p.id,
                ator_tipo: "sistema",
                ator_id: None,
                acao: "criado",
                dados: Some(serde_json::json!({
                    "idreserva": p.idreserva, "tipo": p.tipo, "valor_centavos": p.valor_centavos,
                })),
            },
        )
        .await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(p)
    }

    async fn registrar_tentativa(
        &self,
        tentativa: &NovaTentativa,
    ) -> Result<TentativaPagamento, DomainError> {
        sqlx::query_as::<_, TentativaPagamento>(&format!(
            "INSERT INTO pagamento_tentativa (idpagamento, session_id, session_url, expires_em)
             VALUES ($1, $2, $3, $4) RETURNING {TENTATIVA_COLS}"
        ))
        .bind(tentativa.idpagamento)
        .bind(&tentativa.session_id)
        .bind(&tentativa.session_url)
        .bind(tentativa.expires_em)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn marcar_tentativa_status(
        &self,
        session_id: &str,
        status: &str,
    ) -> Result<(), DomainError> {
        sqlx::query("UPDATE pagamento_tentativa SET status = $2 WHERE session_id = $1")
            .bind(session_id)
            .bind(status)
            .execute(&self.pool)
            .await
            .map_err(map_db_err)?;
        Ok(())
    }

    async fn tentativa_aberta(
        &self,
        idpagamento: i64,
    ) -> Result<Option<TentativaPagamento>, DomainError> {
        sqlx::query_as::<_, TentativaPagamento>(&format!(
            "SELECT {TENTATIVA_COLS} FROM pagamento_tentativa
             WHERE idpagamento = $1 AND status = 'aberta' AND expires_em > now()
             ORDER BY criado_em DESC LIMIT 1"
        ))
        .bind(idpagamento)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn pendentes_com_pi(&self, limite: i64) -> Result<Vec<PagamentoOnline>, DomainError> {
        sqlx::query_as::<_, PagamentoOnline>(&format!(
            "SELECT {PAGAMENTO_COLS} FROM pagamento
             WHERE status = 'pendente' AND pi_id IS NOT NULL
             ORDER BY criado_em LIMIT $1"
        ))
        .bind(limite)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn confirmar_pago(
        &self,
        idpagamento: i64,
        pi_id: &str,
        metodo: Option<&str>,
        auditoria: NovaAuditoriaPagamento,
    ) -> Result<(), DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        // Idempotente: se já liquidado, não duplica nem regrava auditoria.
        let afetadas = sqlx::query(
            "UPDATE pagamento SET status = 'pago', pi_id = COALESCE(pi_id, $2),
                metodo = COALESCE($3, metodo), paid_em = now(), atualizado_em = now()
             WHERE id = $1 AND status != 'pago' RETURNING id",
        )
        .bind(idpagamento)
        .bind(pi_id)
        .bind(metodo)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?;
        if afetadas.is_some() {
            auditar(&mut tx, &auditoria).await?;
        }
        tx.commit().await.map_err(map_db_err)?;
        Ok(())
    }

    async fn marcar_status(
        &self,
        idpagamento: i64,
        status: StatusPagamento,
        auditoria: NovaAuditoriaPagamento,
    ) -> Result<(), DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        sqlx::query("UPDATE pagamento SET status = $2, atualizado_em = now() WHERE id = $1")
            .bind(idpagamento)
            .bind(status)
            .execute(&mut *tx)
            .await
            .map_err(map_db_err)?;
        auditar(&mut tx, &auditoria).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(())
    }

    // -- reembolso -----------------------------------------------------------

    async fn criar_reembolso(
        &self,
        idpagamento: i64,
        valor_centavos: i64,
        motivo: Option<&str>,
        auditoria: NovaAuditoriaPagamento,
    ) -> Result<ReembolsoPagamento, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let r = sqlx::query_as::<_, ReembolsoPagamento>(&format!(
            "INSERT INTO pagamento_reembolso (idpagamento, valor_centavos, motivo)
             VALUES ($1, $2, $3) RETURNING {REEMBOLSO_COLS}"
        ))
        .bind(idpagamento)
        .bind(valor_centavos)
        .bind(motivo)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;
        auditar(&mut tx, &auditoria).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(r)
    }

    async fn atualizar_reembolso(
        &self,
        id: i64,
        refund_id: &str,
        status: StatusReembolso,
    ) -> Result<(), DomainError> {
        sqlx::query(
            "UPDATE pagamento_reembolso SET refund_id = $2, status = $3,
                atualizado_em = now() WHERE id = $1",
        )
        .bind(id)
        .bind(refund_id)
        .bind(status)
        .execute(&self.pool)
        .await
        .map_err(map_db_err)?;
        Ok(())
    }

    async fn listar_reembolsos(
        &self,
        idpagamento: i64,
    ) -> Result<Vec<ReembolsoPagamento>, DomainError> {
        sqlx::query_as::<_, ReembolsoPagamento>(&format!(
            "SELECT {REEMBOLSO_COLS} FROM pagamento_reembolso
             WHERE idpagamento = $1 ORDER BY criado_em DESC"
        ))
        .bind(idpagamento)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn total_reembolsado(&self, idpagamento: i64) -> Result<i64, DomainError> {
        sqlx::query_scalar::<_, i64>(
            "SELECT COALESCE(SUM(valor_centavos), 0)::bigint FROM pagamento_reembolso
             WHERE idpagamento = $1 AND status != 'falhou'",
        )
        .bind(idpagamento)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn refletir_reembolso(
        &self,
        idpagamento: i64,
        auditoria: NovaAuditoriaPagamento,
    ) -> Result<(), DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let total: i64 = sqlx::query_scalar(
            "SELECT COALESCE(SUM(valor_centavos), 0)::bigint FROM pagamento_reembolso
             WHERE idpagamento = $1 AND status = 'concluido'",
        )
        .bind(idpagamento)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;
        // Só recalcula sobre pagamento já liquidado.
        sqlx::query(
            "UPDATE pagamento SET
                status = CASE
                    WHEN $2 >= valor_centavos THEN 'reembolsado'::pagamento_status
                    ELSE 'reembolso_parcial'::pagamento_status END,
                atualizado_em = now()
             WHERE id = $1 AND status IN ('pago', 'reembolso_parcial')",
        )
        .bind(idpagamento)
        .bind(total)
        .execute(&mut *tx)
        .await
        .map_err(map_db_err)?;
        auditar(&mut tx, &auditoria).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(())
    }

    // -- webhook inbox --------------------------------------------------------

    async fn registrar_evento(&self, evento: &NovoEventoWebhook) -> Result<bool, DomainError> {
        let rows = sqlx::query(
            "INSERT INTO pagamento_webhook_evento (provedor, event_id, event_type, payload, idintegracao)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (provedor, event_id) DO NOTHING",
        )
        .bind(&evento.provedor)
        .bind(&evento.event_id)
        .bind(&evento.event_type)
        .bind(&evento.payload)
        .bind(evento.idintegracao)
        .execute(&self.pool)
        .await
        .map_err(map_db_err)?
        .rows_affected();
        Ok(rows > 0)
    }

    async fn marcar_evento(
        &self,
        provedor: &str,
        event_id: &str,
        status: StatusProcWebhook,
        erro: Option<&str>,
    ) -> Result<(), DomainError> {
        sqlx::query(
            "UPDATE pagamento_webhook_evento SET status = $3, ultimo_erro = $4,
                tentativas = tentativas + 1,
                processado_em = CASE WHEN $3 = 'processado' THEN now() ELSE NULL END
             WHERE provedor = $1 AND event_id = $2",
        )
        .bind(provedor)
        .bind(event_id)
        .bind(status)
        .bind(erro)
        .execute(&self.pool)
        .await
        .map_err(map_db_err)?;
        Ok(())
    }

    async fn eventos_pendentes(&self, limite: i64) -> Result<Vec<WebhookEvento>, DomainError> {
        sqlx::query_as::<_, WebhookEvento>(&format!(
            "SELECT {EVENTO_COLS} FROM pagamento_webhook_evento
             WHERE status IN ('recebido','falhou') AND tentativas < 10
             ORDER BY recebido_em LIMIT $1"
        ))
        .bind(limite)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn eventos_da_integracao(
        &self,
        idintegracao: i64,
        limite: i64,
    ) -> Result<Vec<WebhookEvento>, DomainError> {
        sqlx::query_as::<_, WebhookEvento>(&format!(
            "SELECT {EVENTO_COLS} FROM pagamento_webhook_evento
             WHERE idintegracao = $1
             ORDER BY recebido_em DESC LIMIT $2"
        ))
        .bind(idintegracao)
        .bind(limite)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    // -- conciliação de holds --------------------------------------------------

    async fn holds_expirados(&self, limite: i64) -> Result<Vec<(i64, Option<i64>)>, DomainError> {
        sqlx::query_as::<_, (i64, Option<i64>)>(
            "SELECT r.id, (SELECT p.id FROM pagamento p
                WHERE p.idreserva = r.id AND p.status = 'pendente'
                ORDER BY p.criado_em DESC LIMIT 1)
             FROM reserva r
             WHERE r.status = 'p' AND r.expira_em IS NOT NULL AND r.expira_em < now()
             LIMIT $1",
        )
        .bind(limite)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn expirar_hold(
        &self,
        idreserva: i64,
        idpagamento: Option<i64>,
    ) -> Result<(), DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        // Cancela a reserva pendente vencida — a exclusion constraint libera
        // a acomodação imediatamente para outros hóspedes.
        sqlx::query(
            "UPDATE reserva SET status = 'c', atualizado_em = now()
             WHERE id = $1 AND status = 'p'",
        )
        .bind(idreserva)
        .execute(&mut *tx)
        .await
        .map_err(map_db_err)?;
        if let Some(pid) = idpagamento {
            sqlx::query(
                "UPDATE pagamento_tentativa SET status = 'expirada'
                 WHERE idpagamento = $1 AND status = 'aberta'",
            )
            .bind(pid)
            .execute(&mut *tx)
            .await
            .map_err(map_db_err)?;
            sqlx::query(
                "UPDATE pagamento SET status = 'expirado', atualizado_em = now()
                 WHERE id = $1 AND status = 'pendente'",
            )
            .bind(pid)
            .execute(&mut *tx)
            .await
            .map_err(map_db_err)?;
            auditar(
                &mut tx,
                &NovaAuditoriaPagamento {
                    idpagamento: pid,
                    ator_tipo: "sistema",
                    ator_id: None,
                    acao: "expirado",
                    dados: Some(serde_json::json!({"idreserva": idreserva})),
                },
            )
            .await?;
        }
        tx.commit().await.map_err(map_db_err)?;
        Ok(())
    }

    // -- admin / painel --------------------------------------------------------

    async fn listar(
        &self,
        filtro: &FiltroPagamento,
        page: PageParams,
    ) -> Result<Page<PagamentoView>, DomainError> {
        let mut conds = vec!["TRUE".to_string()];
        let mut binds = BindCount::new();
        if filtro.inicio.is_some() {
            conds.push(format!("p.criado_em >= ${}", binds.next()));
        }
        if filtro.fim.is_some() {
            conds.push(format!("p.criado_em < ${}::date + 1", binds.next()));
        }
        if filtro.status.is_some() {
            conds.push(format!("p.status = ${}", binds.next()));
        }
        if filtro.metodo.is_some() {
            conds.push(format!("p.metodo = ${}", binds.next()));
        }
        if filtro.idreserva.is_some() {
            conds.push(format!("p.idreserva = ${}", binds.next()));
        }
        if filtro.busca.is_some() {
            conds.push(format!(
                "(c.nome ILIKE '%' || ${} || '%' OR p.idreserva::text = ${0})",
                binds.next()
            ));
        }
        let where_sql = conds.join(" AND ");
        let base = format!(
            "FROM pagamento p
             JOIN reserva r ON r.id = p.idreserva
             JOIN cliente c ON c.id = r.idcliente
             JOIN acomodacao a ON a.id = r.idacomodacao
             WHERE {where_sql}"
        );

        // Mesma sequência de binds nas duas queries (count + página).
        let sql_total = format!("SELECT COUNT(*) {base}");
        let sql_page = format!(
            "SELECT p.id, p.idreserva, p.tipo, p.status, p.valor_centavos, p.metodo,
                    p.paid_em, p.criado_em, c.nome AS cliente_nome,
                    a.nome AS acomodacao_nome,
                    COALESCE((SELECT SUM(rb.valor_centavos)::bigint FROM pagamento_reembolso rb
                        WHERE rb.idpagamento = p.id AND rb.status = 'concluido'), 0)
                        AS reembolsado_centavos
             {base} ORDER BY p.criado_em DESC
             LIMIT {} OFFSET {}",
            page.limit(),
            page.offset()
        );
        let mut q_total = sqlx::query_scalar::<_, i64>(&sql_total);
        let mut q_page = sqlx::query_as::<_, PagamentoView>(&sql_page);
        // Mesma sequência de valores nas duas queries (count + página).
        for v in BindCount::valores(filtro) {
            match v {
                BindVal::Date(d) => {
                    q_total = q_total.bind(d);
                    q_page = q_page.bind(d);
                }
                BindVal::Status(s) => {
                    q_total = q_total.bind(s);
                    q_page = q_page.bind(s);
                }
                BindVal::Text(t) => {
                    q_total = q_total.bind(t.to_string());
                    q_page = q_page.bind(t.to_string());
                }
                BindVal::I64(n) => {
                    q_total = q_total.bind(n);
                    q_page = q_page.bind(n);
                }
            }
        }
        let total = q_total.fetch_one(&self.pool).await.map_err(map_db_err)?;
        let itens = q_page.fetch_all(&self.pool).await.map_err(map_db_err)?;
        Ok(Page::new(itens, page, total))
    }

    async fn resumo(
        &self,
        inicio: chrono::NaiveDate,
        fim: chrono::NaiveDate,
    ) -> Result<ResumoFinanceiro, DomainError> {
        sqlx::query_as::<_, ResumoFinanceiro>(
            "SELECT
                COALESCE(SUM(valor_centavos) FILTER (WHERE status IN
                    ('pago','reembolso_parcial','reembolsado')), 0)::bigint AS recebido_centavos,
                COALESCE(SUM(valor_centavos) FILTER (WHERE status = 'pendente'), 0)::bigint
                    AS pendente_centavos,
                COALESCE((SELECT SUM(rb.valor_centavos)::bigint FROM pagamento_reembolso rb
                    JOIN pagamento p2 ON p2.id = rb.idpagamento
                    WHERE rb.status = 'concluido'
                      AND rb.criado_em >= $1 AND rb.criado_em < $2::date + 1), 0)::bigint
                    AS reembolsado_centavos,
                COUNT(*) FILTER (WHERE status IN
                    ('pago','reembolso_parcial','reembolsado')) AS total_pagos,
                COUNT(*) FILTER (WHERE status = 'pendente') AS total_pendentes,
                COUNT(*) FILTER (WHERE status IN ('falhou','expirado')) AS total_recusados,
                COALESCE(SUM(valor_centavos) FILTER (WHERE metodo = 'card'
                    AND status IN ('pago','reembolso_parcial','reembolsado')), 0)::bigint
                    AS card_centavos,
                COALESCE(SUM(valor_centavos) FILTER (WHERE metodo = 'pix'
                    AND status IN ('pago','reembolso_parcial','reembolsado')), 0)::bigint
                    AS pix_centavos
             FROM pagamento
             WHERE criado_em >= $1 AND criado_em < $2::date + 1",
        )
        .bind(inicio)
        .bind(fim)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn receita_por_acomodacao(
        &self,
        inicio: chrono::NaiveDate,
        fim: chrono::NaiveDate,
    ) -> Result<Vec<ReceitaAcomodacao>, DomainError> {
        sqlx::query_as::<_, ReceitaAcomodacao>(
            "SELECT a.id AS idacomodacao, a.nome,
                    COALESCE(SUM(p.valor_centavos), 0)::bigint AS recebido_centavos,
                    COUNT(p.id) AS total_pagos
             FROM acomodacao a
             JOIN reserva r ON r.idacomodacao = a.id
             JOIN pagamento p ON p.idreserva = r.id
             WHERE p.status IN ('pago','reembolso_parcial','reembolsado')
               AND p.paid_em >= $1 AND p.paid_em < $2::date + 1
             GROUP BY a.id, a.nome ORDER BY recebido_centavos DESC",
        )
        .bind(inicio)
        .bind(fim)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn reserva_por_token(&self, token: Uuid) -> Result<Option<i64>, DomainError> {
        sqlx::query_scalar::<_, i64>("SELECT id FROM reserva WHERE token_publico = $1")
            .bind(token)
            .fetch_optional(&self.pool)
            .await
            .map_err(map_db_err)
    }
}

// ---------------------------------------------------------------------------
// binds dinâmicos do filtro admin — mantém $n coerente entre count e página
// ---------------------------------------------------------------------------

enum BindVal<'a> {
    Date(chrono::NaiveDate),
    Status(StatusPagamento),
    Text(&'a str),
    I64(i64),
}

struct BindCount(usize);

impl BindCount {
    fn new() -> Self {
        Self(1)
    }

    fn next(&mut self) -> usize {
        let n = self.0;
        self.0 += 1;
        n
    }

    fn valores(filtro: &FiltroPagamento) -> Vec<BindVal<'_>> {
        let mut v = Vec::new();
        if let Some(d) = filtro.inicio {
            v.push(BindVal::Date(d));
        }
        if let Some(d) = filtro.fim {
            v.push(BindVal::Date(d));
        }
        if let Some(s) = filtro.status {
            v.push(BindVal::Status(s));
        }
        if let Some(m) = filtro.metodo.as_deref() {
            v.push(BindVal::Text(m));
        }
        if let Some(id) = filtro.idreserva {
            v.push(BindVal::I64(id));
        }
        if let Some(b) = filtro.busca.as_deref() {
            v.push(BindVal::Text(b));
        }
        v
    }
}
