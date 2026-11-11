//! Auditoria, dashboard e financeiro — leituras agregadas + inserção de log.

use crate::persistence::db::map_db_err;
use async_trait::async_trait;
use chrono::NaiveDate;
use clarituz_domain::entities::{NovoLog, RegistroLog};
use clarituz_domain::ports::{DashboardRepository, FiltroLog, FinanceiroRepository, LogRepository};
use clarituz_domain::queries::{
    DashboardCards, ItemMaisVendido, PendenciaDia, PontoSerie, ReservaResumo, ResumoFinanceiro,
    VendaItem,
};
use clarituz_domain::value_objects::PeriodoEstadia;
use clarituz_domain::DomainError;
use clarituz_shared::{Page, PageParams};
use rust_decimal::Decimal;
use sqlx::PgPool;

// ===========================================================================
// Auditoria
// ===========================================================================

#[derive(Clone)]
pub struct PgLogRepository {
    pool: PgPool,
}
impl PgLogRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl LogRepository for PgLogRepository {
    async fn inserir(&self, log: NovoLog) -> Result<(), DomainError> {
        super::audit::gravar(&self.pool, &log).await
    }

    async fn listar(
        &self,
        filtro: &FiltroLog,
        page: PageParams,
    ) -> Result<Page<RegistroLog>, DomainError> {
        const WHERE: &str = "
            WHERE ($1::text IS NULL OR l.tabela = $1)
              AND ($2::text IS NULL OR l.acao = $2)
              AND ($3::bigint IS NULL OR l.idfuncionario = $3)
              AND ($4::date IS NULL OR l.criado_em::date >= $4)
              AND ($5::date IS NULL OR l.criado_em::date <= $5)
              AND ($6::bigint IS NULL OR l.idtabela = $6)";

        let total = sqlx::query_scalar::<_, i64>(&format!("SELECT COUNT(*) FROM log l {WHERE}"))
            .bind(&filtro.tabela)
            .bind(&filtro.acao)
            .bind(filtro.idfuncionario)
            .bind(filtro.desde)
            .bind(filtro.ate)
            .bind(filtro.idtabela)
            .fetch_one(&self.pool)
            .await
            .map_err(map_db_err)?;

        let items = sqlx::query_as::<_, RegistroLog>(&format!(
            "SELECT l.id, l.idfuncionario, f.nome AS funcionario_nome, l.acao, l.obs,
                    l.tabela, l.idtabela, l.dados, l.criado_em
             FROM log l LEFT JOIN funcionario f ON f.id = l.idfuncionario
             {WHERE} ORDER BY l.id DESC LIMIT $7 OFFSET $8"
        ))
        .bind(&filtro.tabela)
        .bind(&filtro.acao)
        .bind(filtro.idfuncionario)
        .bind(filtro.desde)
        .bind(filtro.ate)
        .bind(filtro.idtabela)
        .bind(page.limit())
        .bind(page.offset())
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)?;

        Ok(Page::new(items, page, total))
    }
}

// ===========================================================================
// Dashboard
// ===========================================================================

#[derive(Clone)]
pub struct PgDashboardRepository {
    pool: PgPool,
}
impl PgDashboardRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl DashboardRepository for PgDashboardRepository {
    /// Todos os contadores em **uma única query** — o legado executava
    /// N+1 consultas por card (`dadosCard.php`).
    async fn cards(&self, hoje: NaiveDate) -> Result<DashboardCards, DomainError> {
        sqlx::query_as::<_, DashboardCards>(
            "SELECT
                (SELECT COUNT(*) FROM acomodacao WHERE ativo) AS total_acomodacoes,
                (SELECT COUNT(*) FROM acomodacao a WHERE a.ativo AND NOT EXISTS (
                    SELECT 1 FROM reserva r WHERE r.idacomodacao = a.id
                      AND (r.status = 'i' OR (r.status = 'p' AND r.entradaprevista <= $1 AND r.saidaprevista >= $1))
                )) AS acomodacoes_disponiveis,
                (SELECT COUNT(DISTINCT idacomodacao) FROM reserva WHERE status = 'i')
                    AS acomodacoes_ocupadas,
                (SELECT COALESCE(SUM(quantidade_hospedes),0) FROM reserva WHERE status = 'i')
                    AS hospedes_atuais,
                (SELECT COUNT(*) FROM reserva WHERE checkin_em::date = $1) AS checkins_hoje,
                (SELECT COUNT(*) FROM reserva WHERE checkout_em::date = $1) AS checkouts_hoje,
                (SELECT COUNT(*) FROM reserva WHERE entradaprevista = $1 AND status = 'p')
                    AS checkins_pendentes_hoje,
                (SELECT COUNT(*) FROM reserva WHERE saidaprevista = $1 AND status = 'i')
                    AS checkouts_pendentes_hoje",
        )
        .bind(hoje)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn ultimas_reservas(&self, limite: i64) -> Result<Vec<ReservaResumo>, DomainError> {
        sqlx::query_as::<_, ReservaResumo>(
            "SELECT r.id, r.idacomodacao, a.nome AS acomodacao_nome, a.numero AS acomodacao_numero,
                    a.cor AS acomodacao_cor, r.idcliente, c.nome AS cliente_nome,
                    r.quantidade_hospedes, r.entradaprevista, r.saidaprevista, r.status,
                    r.valordiaria, r.idquarto, q.numero AS quarto_numero, con.valor_estadia
             FROM reserva r
             JOIN acomodacao a ON a.id = r.idacomodacao
             JOIN cliente c ON c.id = r.idcliente
             LEFT JOIN quarto q ON q.id = r.idquarto
             LEFT JOIN consumo con ON con.idreserva = r.id
             ORDER BY r.id DESC LIMIT $1",
        )
        .bind(limite)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn checkins_pendentes(&self, hoje: NaiveDate) -> Result<Vec<PendenciaDia>, DomainError> {
        sqlx::query_as::<_, PendenciaDia>(
            "SELECT r.id AS idreserva, a.nome AS acomodacao_nome, c.nome AS cliente_nome,
                    r.entradaprevista, r.saidaprevista
             FROM reserva r
             JOIN acomodacao a ON a.id = r.idacomodacao
             JOIN cliente c ON c.id = r.idcliente
             WHERE r.entradaprevista <= $1 AND r.status = 'p'
             ORDER BY r.entradaprevista",
        )
        .bind(hoje)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn checkouts_pendentes(&self, hoje: NaiveDate) -> Result<Vec<PendenciaDia>, DomainError> {
        sqlx::query_as::<_, PendenciaDia>(
            "SELECT r.id AS idreserva, a.nome AS acomodacao_nome, c.nome AS cliente_nome,
                    r.entradaprevista, r.saidaprevista
             FROM reserva r
             JOIN acomodacao a ON a.id = r.idacomodacao
             JOIN cliente c ON c.id = r.idcliente
             WHERE r.saidaprevista <= $1 AND r.status = 'i'
             ORDER BY r.saidaprevista",
        )
        .bind(hoje)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn acomodacoes_disponiveis_hoje(
        &self,
        hoje: NaiveDate,
    ) -> Result<Vec<(i64, String, i32)>, DomainError> {
        sqlx::query_as::<_, (i64, String, i32)>(
            "SELECT a.id, a.nome, a.numero FROM acomodacao a
             WHERE a.ativo AND NOT EXISTS (
                SELECT 1 FROM reserva r WHERE r.idacomodacao = a.id
                  AND r.status IN ('p','i')
                  AND r.periodo && daterange($1, $1, '[]')
             ) ORDER BY a.numero",
        )
        .bind(hoje)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn acomodacoes_ocupadas(&self) -> Result<Vec<(i64, String, i32)>, DomainError> {
        sqlx::query_as::<_, (i64, String, i32)>(
            "SELECT DISTINCT a.id, a.nome, a.numero FROM acomodacao a
             JOIN reserva r ON r.idacomodacao = a.id AND r.status = 'i'
             ORDER BY a.numero",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }
}

// ===========================================================================
// Financeiro
// ===========================================================================

#[derive(Clone)]
pub struct PgFinanceiroRepository {
    pool: PgPool,
}
impl PgFinanceiroRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl FinanceiroRepository for PgFinanceiroRepository {
    /// Recebido (fechado) + previsto (em aberto) num período —
    /// equivalente a `financeiro/include/valores.php`, agregado em SQL.
    async fn resumo(&self, periodo: PeriodoEstadia) -> Result<ResumoFinanceiro, DomainError> {
        sqlx::query_as::<_, ResumoFinanceiroRow>(
            "SELECT
                COALESCE(SUM(c.valor_final) FILTER (WHERE c.status = 'concluido'), 0) AS recebido,
                COALESCE(SUM(c.valor_estadia) FILTER (WHERE c.status = 'concluido'), 0) AS recebido_estadias,
                COALESCE(SUM(c.valor_itens) FILTER (WHERE c.status = 'concluido'), 0) AS recebido_itens,
                COALESCE(SUM(c.valor_adicional) FILTER (WHERE c.status = 'concluido'), 0) AS recebido_adicionais,
                COALESCE(SUM(c.total_desconto) FILTER (WHERE c.status = 'concluido'), 0) AS descontos,
                COUNT(*) FILTER (WHERE c.status = 'concluido') AS qtd_contas_fechadas,
                (SELECT COALESCE(SUM(c2.valor_estadia + c2.valor_itens), 0)
                   FROM consumo c2 JOIN reserva r ON r.id = c2.idreserva
                   WHERE r.status NOT IN ('c','f')
                     AND r.saidaprevista BETWEEN $1 AND $2) AS previsto
             FROM consumo c
             WHERE c.fechado_em::date BETWEEN $1 AND $2",
        )
        .bind(periodo.entrada)
        .bind(periodo.saida)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)
        .map(Into::into)
    }

    async fn serie_recebido(
        &self,
        periodo: PeriodoEstadia,
    ) -> Result<Vec<PontoSerie>, DomainError> {
        sqlx::query_as::<_, PontoSerie>(
            "SELECT to_char(d.dia, 'DD/MM') AS rotulo,
                    COALESCE(SUM(c.valor_final), 0) AS valor,
                    COUNT(c.id) AS quantidade
             FROM generate_series($1::date, $2::date, '1 day') d(dia)
             LEFT JOIN consumo c ON c.fechado_em::date = d.dia AND c.status = 'concluido'
             GROUP BY d.dia ORDER BY d.dia",
        )
        .bind(periodo.entrada)
        .bind(periodo.saida)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn recebido_por_pagamento(
        &self,
        periodo: PeriodoEstadia,
    ) -> Result<Vec<PontoSerie>, DomainError> {
        sqlx::query_as::<_, PontoSerie>(
            "SELECT COALESCE(fp.nome, 'não informado') AS rotulo,
                    COALESCE(SUM(c.valor_final), 0) AS valor,
                    COUNT(c.id) AS quantidade
             FROM consumo c
             LEFT JOIN forma_pagamento fp ON fp.id = c.idforma_pagamento
             WHERE c.status = 'concluido' AND c.fechado_em::date BETWEEN $1 AND $2
             GROUP BY fp.nome ORDER BY valor DESC",
        )
        .bind(periodo.entrada)
        .bind(periodo.saida)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn serie_reservas(
        &self,
        periodo: PeriodoEstadia,
    ) -> Result<Vec<PontoSerie>, DomainError> {
        sqlx::query_as::<_, PontoSerie>(
            "SELECT to_char(d.dia, 'DD/MM') AS rotulo,
                    COALESCE(SUM(r.valordiaria), 0) AS valor,
                    COUNT(r.id) AS quantidade
             FROM generate_series($1::date, $2::date, '1 day') d(dia)
             LEFT JOIN reserva r ON r.criado_em::date = d.dia AND r.status != 'c'
             GROUP BY d.dia ORDER BY d.dia",
        )
        .bind(periodo.entrada)
        .bind(periodo.saida)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn serie_vendas(&self, periodo: PeriodoEstadia) -> Result<Vec<PontoSerie>, DomainError> {
        sqlx::query_as::<_, PontoSerie>(
            "SELECT to_char(d.dia, 'DD/MM') AS rotulo,
                    COALESCE(SUM(ic.valor_total), 0) AS valor,
                    COALESCE(SUM(ic.quantidade), 0)::bigint AS quantidade
             FROM generate_series($1::date, $2::date, '1 day') d(dia)
             LEFT JOIN item_consumido ic ON ic.criado_em::date = d.dia
             GROUP BY d.dia ORDER BY d.dia",
        )
        .bind(periodo.entrada)
        .bind(periodo.saida)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn itens_mais_vendidos(
        &self,
        periodo: PeriodoEstadia,
    ) -> Result<Vec<ItemMaisVendido>, DomainError> {
        sqlx::query_as::<_, ItemMaisVendido>(
            "SELECT nome,
                    SUM(quantidade)::bigint AS quantidade,
                    SUM(valor_total) AS valor
             FROM item_consumido
             WHERE criado_em::date BETWEEN $1 AND $2
             GROUP BY nome
             ORDER BY quantidade DESC, valor DESC
             LIMIT 10",
        )
        .bind(periodo.entrada)
        .bind(periodo.saida)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn vendas(&self, periodo: PeriodoEstadia) -> Result<Vec<VendaItem>, DomainError> {
        sqlx::query_as::<_, VendaItem>(
            "SELECT c.idreserva,
                    ic.nome AS item,
                    ic.quantidade,
                    ic.valor_total,
                    ic.criado_em
             FROM item_consumido ic
             JOIN consumo c ON c.id = ic.idconsumo
             WHERE ic.criado_em::date BETWEEN $1 AND $2
             ORDER BY ic.criado_em DESC",
        )
        .bind(periodo.entrada)
        .bind(periodo.saida)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn lucro_por_acomodacao(
        &self,
        periodo: PeriodoEstadia,
    ) -> Result<Vec<PontoSerie>, DomainError> {
        sqlx::query_as::<_, PontoSerie>(
            "SELECT a.nome AS rotulo,
                    COALESCE(SUM(c.valor_estadia), 0) AS valor,
                    COUNT(r.id) AS quantidade
             FROM reserva r
             JOIN acomodacao a ON a.id = r.idacomodacao
             LEFT JOIN consumo c ON c.idreserva = r.id
             WHERE r.status != 'c'
               AND r.periodo && daterange($1, $2, '[]')
             GROUP BY a.nome
             ORDER BY valor DESC",
        )
        .bind(periodo.entrada)
        .bind(periodo.saida)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }
}

// linha interna mapeável pelo FromRow antes de virar read model público
#[derive(sqlx::FromRow)]
struct ResumoFinanceiroRow {
    recebido: Decimal,
    recebido_estadias: Decimal,
    recebido_itens: Decimal,
    recebido_adicionais: Decimal,
    previsto: Decimal,
    descontos: Decimal,
    qtd_contas_fechadas: i64,
}

impl From<ResumoFinanceiroRow> for ResumoFinanceiro {
    fn from(r: ResumoFinanceiroRow) -> Self {
        Self {
            recebido: r.recebido,
            recebido_estadias: r.recebido_estadias,
            recebido_itens: r.recebido_itens,
            recebido_adicionais: r.recebido_adicionais,
            previsto: r.previsto,
            descontos: r.descontos,
            qtd_contas_fechadas: r.qtd_contas_fechadas,
        }
    }
}
