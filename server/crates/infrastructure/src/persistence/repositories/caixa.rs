//! Controle de caixa: turnos de gaveta por operador com conferência
//! automática — o valor esperado é sempre derivado do ledger, nunca digitado.

use super::audit;
use crate::persistence::db::map_db_err;
use async_trait::async_trait;
use clarituz_domain::entities::{CaixaMovimento, CaixaTurno, NovoLog};
use clarituz_domain::enums::TipoMovimentoCaixa;
use clarituz_domain::ports::{CaixaRepository, FiltroTurno, NovaAberturaCaixa, NovaMovCaixa};
use clarituz_domain::queries::{ConferenciaCaixa, ConferenciaLinha, MovimentoCaixaView, TurnoView};
use clarituz_domain::DomainError;
use clarituz_shared::{Page, PageParams};
use rust_decimal::Decimal;
use sqlx::PgPool;

#[derive(Clone)]
pub struct PgCaixaRepository {
    pool: PgPool,
}
impl PgCaixaRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

const TURNO_COLS: &str = "id, idconta_financeira, idoperador, saldo_inicial,
     aberto_em, fechado_em, valor_contado, valor_esperado, quebra, status,
     observacao, fechado_por, version, criado_em, atualizado_em";

const TURNO_VIEW_SQL: &str = "
    SELECT t.id, t.idconta_financeira, cf.nome AS conta_financeira,
           t.idoperador, f.nome AS operador,
           t.saldo_inicial, t.aberto_em, t.fechado_em,
           t.valor_contado, t.valor_esperado, t.quebra, t.status, t.observacao,
           COALESCE(m.suprimentos, 0) AS total_suprimentos,
           COALESCE(m.sangrias, 0)    AS total_sangrias,
           t.version, t.criado_em
    FROM caixa_turno t
    JOIN conta_financeira cf ON cf.id = t.idconta_financeira
    JOIN funcionario f ON f.id = t.idoperador
    LEFT JOIN (
        SELECT idturno,
               SUM(valor) FILTER (WHERE tipo = 'suprimento') AS suprimentos,
               SUM(valor) FILTER (WHERE tipo = 'sangria')    AS sangrias
        FROM caixa_movimento GROUP BY idturno
    ) m ON m.idturno = t.id";

/// Esperado corrente na gaveta dentro da janela do turno:
/// fundo + suprimentos − sangrias + recebimentos − pagamentos + espécie.
const ESPERADO_SQL: &str = "
    SELECT
      t.saldo_inicial
      + COALESCE((SELECT SUM(m.valor) FROM caixa_movimento m
                   WHERE m.idturno = t.id AND m.tipo = 'suprimento'), 0)
      - COALESCE((SELECT SUM(m.valor) FROM caixa_movimento m
                   WHERE m.idturno = t.id AND m.tipo = 'sangria'), 0)
      + COALESCE((SELECT SUM(b.valor) FROM baixa_lancamento b
                   JOIN lancamento l ON l.id = b.idlancamento
                   WHERE b.idconta_financeira = t.idconta_financeira
                     AND l.tipo = 'receber' AND l.status != 'cancelado'
                     AND b.data >= t.aberto_em::date
                     AND b.data <= COALESCE(t.fechado_em::date, CURRENT_DATE)), 0)
      - COALESCE((SELECT SUM(b.valor) FROM baixa_lancamento b
                   JOIN lancamento l ON l.id = b.idlancamento
                   WHERE b.idconta_financeira = t.idconta_financeira
                     AND l.tipo = 'pagar' AND l.status != 'cancelado'
                     AND b.data >= t.aberto_em::date
                     AND b.data <= COALESCE(t.fechado_em::date, CURRENT_DATE)), 0)
      + COALESCE((SELECT SUM(c.valor_final) FROM consumo c
                   JOIN forma_pagamento fp ON fp.id = c.idforma_pagamento
                   WHERE c.status = 'concluido' AND fp.especie
                     AND c.fechado_em >= t.aberto_em
                     AND (t.fechado_em IS NULL OR c.fechado_em <= t.fechado_em)), 0)
    FROM caixa_turno t WHERE t.id = $1";

#[derive(sqlx::FromRow)]
struct ComponentesEsperado {
    suprimentos: Decimal,
    sangrias: Decimal,
    recebimentos: Decimal,
    pagamentos: Decimal,
    especie: Decimal,
}

const COMPONENTES_SQL: &str = "
    SELECT
      COALESCE((SELECT SUM(m.valor) FROM caixa_movimento m
                 WHERE m.idturno = t.id AND m.tipo = 'suprimento'), 0) AS suprimentos,
      COALESCE((SELECT SUM(m.valor) FROM caixa_movimento m
                 WHERE m.idturno = t.id AND m.tipo = 'sangria'), 0)    AS sangrias,
      COALESCE((SELECT SUM(b.valor) FROM baixa_lancamento b
                 JOIN lancamento l ON l.id = b.idlancamento
                 WHERE b.idconta_financeira = t.idconta_financeira
                   AND l.tipo = 'receber' AND l.status != 'cancelado'
                   AND b.data >= t.aberto_em::date
                   AND b.data <= COALESCE(t.fechado_em::date, CURRENT_DATE)), 0) AS recebimentos,
      COALESCE((SELECT SUM(b.valor) FROM baixa_lancamento b
                 JOIN lancamento l ON l.id = b.idlancamento
                 WHERE b.idconta_financeira = t.idconta_financeira
                   AND l.tipo = 'pagar' AND l.status != 'cancelado'
                   AND b.data >= t.aberto_em::date
                   AND b.data <= COALESCE(t.fechado_em::date, CURRENT_DATE)), 0) AS pagamentos,
      COALESCE((SELECT SUM(c.valor_final) FROM consumo c
                 JOIN forma_pagamento fp ON fp.id = c.idforma_pagamento
                 WHERE c.status = 'concluido' AND fp.especie
                   AND c.fechado_em >= t.aberto_em
                   AND (t.fechado_em IS NULL OR c.fechado_em <= t.fechado_em)), 0) AS especie
    FROM caixa_turno t WHERE t.id = $1";

#[async_trait]
impl CaixaRepository for PgCaixaRepository {
    async fn abrir(
        &self,
        nova: &NovaAberturaCaixa,
        idoperador: i64,
        log: NovoLog,
    ) -> Result<CaixaTurno, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;

        // gaveta existe, está ativa e é tipo caixa?
        let conta_ok: bool = sqlx::query_scalar(
            "SELECT EXISTS(
                SELECT 1 FROM conta_financeira
                WHERE id = $1 AND ativo AND tipo = 'caixa')",
        )
        .bind(nova.idconta_financeira)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;
        if !conta_ok {
            return Err(DomainError::regra(
                "Conta inexistente, inativa ou não é do tipo caixa físico.",
            ));
        }

        let t = sqlx::query_as::<_, CaixaTurno>(&format!(
            "INSERT INTO caixa_turno (idconta_financeira, idoperador, saldo_inicial, observacao)
             VALUES ($1, $2, $3, $4) RETURNING {TURNO_COLS}"
        ))
        .bind(nova.idconta_financeira)
        .bind(idoperador)
        .bind(nova.saldo_inicial)
        .bind(&nova.observacao)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| {
            // único aberto por gaveta → conflito amigável
            map_db_err(e)
        })?;

        let mut log = log;
        log.idtabela = t.id;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(t)
    }

    async fn turno_aberto(
        &self,
        idconta_financeira: i64,
    ) -> Result<Option<CaixaTurno>, DomainError> {
        sqlx::query_as::<_, CaixaTurno>(&format!(
            "SELECT {TURNO_COLS} FROM caixa_turno
             WHERE idconta_financeira = $1 AND status = 'aberto'"
        ))
        .bind(idconta_financeira)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn buscar_turno(&self, id: i64) -> Result<Option<TurnoView>, DomainError> {
        sqlx::query_as::<_, TurnoView>(&format!("{TURNO_VIEW_SQL} WHERE t.id = $1"))
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map_err(map_db_err)
    }

    async fn listar_turnos(
        &self,
        filtro: &FiltroTurno,
        page: PageParams,
    ) -> Result<Page<TurnoView>, DomainError> {
        const WHERE: &str = "
            WHERE ($1::bigint IS NULL OR t.idconta_financeira = $1)
              AND ($2::caixa_turno_status IS NULL OR t.status = $2)
              AND ($3::bigint IS NULL OR t.idoperador = $3)
              AND ($4::date IS NULL OR t.aberto_em::date >= $4)
              AND ($5::date IS NULL OR t.aberto_em::date <= $5)";

        let total =
            sqlx::query_scalar::<_, i64>(&format!("SELECT COUNT(*) FROM caixa_turno t {WHERE}"))
                .bind(filtro.idconta_financeira)
                .bind(filtro.status)
                .bind(filtro.idoperador)
                .bind(filtro.inicio)
                .bind(filtro.fim)
                .fetch_one(&self.pool)
                .await
                .map_err(map_db_err)?;

        let items = sqlx::query_as::<_, TurnoView>(&format!(
            "{TURNO_VIEW_SQL} {WHERE}
             ORDER BY CASE t.status WHEN 'aberto' THEN 0 ELSE 1 END,
                      t.aberto_em DESC
             LIMIT $6 OFFSET $7"
        ))
        .bind(filtro.idconta_financeira)
        .bind(filtro.status)
        .bind(filtro.idoperador)
        .bind(filtro.inicio)
        .bind(filtro.fim)
        .bind(page.limit())
        .bind(page.offset())
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)?;

        Ok(Page::new(items, page, total))
    }

    async fn listar_movimentos(
        &self,
        idturno: i64,
    ) -> Result<Vec<MovimentoCaixaView>, DomainError> {
        sqlx::query_as::<_, MovimentoCaixaView>(
            "SELECT m.id, m.idturno, m.tipo, m.valor, m.motivo,
                    f.nome AS funcionario, m.criado_em
             FROM caixa_movimento m
             JOIN funcionario f ON f.id = m.idfuncionario
             WHERE m.idturno = $1
             ORDER BY m.criado_em, m.id",
        )
        .bind(idturno)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn movimentar(
        &self,
        idturno: i64,
        mov: &NovaMovCaixa,
        idfuncionario: i64,
        log: NovoLog,
    ) -> Result<CaixaMovimento, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;

        let turno = sqlx::query_as::<_, CaixaTurno>(&format!(
            "SELECT {TURNO_COLS} FROM caixa_turno WHERE id = $1 FOR UPDATE"
        ))
        .bind(idturno)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| DomainError::nao_encontrado("Turno não encontrado."))?;

        if !turno.aberto() {
            return Err(DomainError::regra(
                "Turno fechado — movimentos só em turno aberto.",
            ));
        }

        // sangria não pode superar o que a gaveta deveria ter agora
        if mov.tipo == TipoMovimentoCaixa::Sangria {
            let esperado = sqlx::query_scalar::<_, Decimal>(ESPERADO_SQL)
                .bind(idturno)
                .fetch_one(&mut *tx)
                .await
                .map_err(map_db_err)?;
            if mov.valor > esperado {
                return Err(DomainError::regra(format!(
                    "Sangria excede o esperado em gaveta ({esperado})."
                )));
            }
        }

        let m = sqlx::query_as::<_, CaixaMovimento>(
            "INSERT INTO caixa_movimento (idturno, tipo, valor, motivo, idfuncionario)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, idturno, tipo, valor, motivo, idfuncionario, criado_em",
        )
        .bind(idturno)
        .bind(mov.tipo)
        .bind(mov.valor)
        .bind(&mov.motivo)
        .bind(idfuncionario)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;

        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(m)
    }

    async fn conferir(&self, idturno: i64) -> Result<ConferenciaCaixa, DomainError> {
        // detalhamento: baixas da tesouraria + consumos em espécie na janela
        #[derive(sqlx::FromRow)]
        struct LinhaRow {
            origem: String,
            descricao: String,
            valor: Decimal,
            sinal: i32,
            criado_em: chrono::DateTime<chrono::Utc>,
        }

        let turno = self
            .buscar_turno(idturno)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Turno não encontrado."))?;

        let c = sqlx::query_as::<_, ComponentesEsperado>(COMPONENTES_SQL)
            .bind(idturno)
            .fetch_one(&self.pool)
            .await
            .map_err(map_db_err)?;

        let esperado = turno.saldo_inicial + c.suprimentos - c.sangrias + c.recebimentos
            - c.pagamentos
            + c.especie;

        let movimentos = self.listar_movimentos(idturno).await?;

        let linhas = sqlx::query_as::<_, LinhaRow>(
            "SELECT x.origem, x.descricao, x.valor, x.sinal, x.criado_em FROM (
                SELECT 'baixa' AS origem,
                       (CASE WHEN l.tipo = 'receber' THEN 'Recebimento: '
                             ELSE 'Pagamento: ' END) || l.descricao AS descricao,
                       b.valor,
                       CASE WHEN l.tipo = 'receber' THEN 1 ELSE -1 END AS sinal,
                       b.data::timestamptz AS criado_em
                FROM baixa_lancamento b
                JOIN lancamento l ON l.id = b.idlancamento
                JOIN caixa_turno t ON t.id = $1
                WHERE b.idconta_financeira = t.idconta_financeira
                  AND l.status != 'cancelado'
                  AND b.data >= t.aberto_em::date
                  AND b.data <= COALESCE(t.fechado_em::date, CURRENT_DATE)
                UNION ALL
                SELECT 'consumo',
                       'Checkout reserva Nº' || c.idreserva || ' (espécie)',
                       c.valor_final, 1, c.fechado_em
                FROM consumo c
                JOIN forma_pagamento fp ON fp.id = c.idforma_pagamento
                JOIN caixa_turno t ON t.id = $1
                WHERE c.status = 'concluido' AND fp.especie
                  AND c.fechado_em >= t.aberto_em
                  AND (t.fechado_em IS NULL OR c.fechado_em <= t.fechado_em)
             ) x ORDER BY x.criado_em",
        )
        .bind(idturno)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)?;

        let fundo = turno.saldo_inicial;
        Ok(ConferenciaCaixa {
            turno,
            fundo,
            suprimentos: c.suprimentos,
            sangrias: c.sangrias,
            recebimentos: c.recebimentos,
            pagamentos: c.pagamentos,
            especie: c.especie,
            esperado,
            movimentos,
            linhas: linhas
                .into_iter()
                .map(|l| ConferenciaLinha {
                    origem: l.origem,
                    descricao: l.descricao,
                    valor: l.valor,
                    sinal: l.sinal,
                    criado_em: l.criado_em,
                })
                .collect(),
        })
    }

    async fn fechar(
        &self,
        idturno: i64,
        valor_contado: Decimal,
        observacao: Option<String>,
        idfuncionario: i64,
        log: NovoLog,
    ) -> Result<CaixaTurno, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;

        let turno = sqlx::query_as::<_, CaixaTurno>(&format!(
            "SELECT {TURNO_COLS} FROM caixa_turno WHERE id = $1 FOR UPDATE"
        ))
        .bind(idturno)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| DomainError::nao_encontrado("Turno não encontrado."))?;

        if !turno.aberto() {
            return Err(DomainError::conflito("Turno já está fechado."));
        }

        // esperado calculado DENTRO da tx — ninguém movimenta entre o cálculo e o fechamento
        let esperado = sqlx::query_scalar::<_, Decimal>(ESPERADO_SQL)
            .bind(idturno)
            .fetch_one(&mut *tx)
            .await
            .map_err(map_db_err)?;
        let quebra = valor_contado - esperado;

        let t = sqlx::query_as::<_, CaixaTurno>(&format!(
            "UPDATE caixa_turno SET
                status = 'fechado',
                fechado_em = now(),
                valor_contado = $2,
                valor_esperado = $3,
                quebra = $4,
                observacao = COALESCE($5, observacao),
                fechado_por = $6,
                atualizado_em = now()
             WHERE id = $1
             RETURNING {TURNO_COLS}"
        ))
        .bind(idturno)
        .bind(valor_contado)
        .bind(esperado)
        .bind(quebra)
        .bind(&observacao)
        .bind(idfuncionario)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;

        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(t)
    }
}
