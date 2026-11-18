//! Leituras analíticas do módulo preditivo — todas somente-leitura.
//! As queries cruzam reservas × consumo × pagamentos × estoque ×
//! escalas × manutenção; scores e classificações ficam no service.

use async_trait::async_trait;
use clarituz_domain::entities::preditivo::*;
use clarituz_domain::error::DomainError;
use clarituz_domain::ports::preditivo::PreditivoRepository;
use sqlx::PgPool;

use crate::persistence::db::map_db_err;

pub struct PgPreditivoRepository {
    pool: PgPool,
}

impl PgPreditivoRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl PreditivoRepository for PgPreditivoRepository {
    /// Ocupação dia a dia nos próximos 14d: reserva 'p' reserva o período
    /// inteiro [entrada, saída]; 'i' idem (hóspede dentro).
    async fn ocupacao_14d(&self) -> Result<Vec<DiaOcupacao>, DomainError> {
        sqlx::query_as::<_, DiaOcupacao>(
            "WITH dias AS (
                 SELECT generate_series(CURRENT_DATE, CURRENT_DATE + 13, '1 day')::date AS d
             )
             SELECT d AS data,
                 (SELECT count(*) FROM reserva r
                   WHERE r.status IN ('p','i')
                     AND r.entradaprevista <= d AND r.saidaprevista >= d) AS ocupados,
                 (SELECT count(*) FROM acomodacao a WHERE a.ativo) AS total_quartos,
                 (SELECT count(*) FROM reserva r
                   WHERE r.status = 'p' AND r.entradaprevista = d) AS checkins,
                 (SELECT count(*) FROM reserva r
                   WHERE r.status IN ('p','i') AND r.saidaprevista = d) AS checkouts,
                 (SELECT count(*) FROM reserva r
                   WHERE r.status IN ('p','i')
                     AND r.entradaprevista < d AND r.saidaprevista > d) AS stayovers
             FROM dias ORDER BY d",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    /// Receita prevista por semana — desdobra cada reserva ativa em diárias
    /// dentro da janela e soma valordiaria por semana da diária.
    async fn receita_4sem(&self) -> Result<Vec<SemanaReceita>, DomainError> {
        sqlx::query_as::<_, SemanaReceita>(
            "SELECT date_trunc('week', n)::date AS semana,
                 count(*) AS diarias,
                 sum(r.valordiaria) AS receita
             FROM reserva r
             JOIN LATERAL generate_series(
                      greatest(r.entradaprevista, CURRENT_DATE),
                      least(r.saidaprevista, CURRENT_DATE + 27),
                      '1 day') n ON true
             WHERE r.status IN ('p','i')
               AND r.saidaprevista >= CURRENT_DATE
               AND r.entradaprevista <= CURRENT_DATE + 27
             GROUP BY 1 ORDER BY 1",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    /// Fluxo 30d — três agregados numa passada:
    ///  * confirmadas: lançamentos 'receber' abertos vencendo na janela
    ///    + pagamentos de reserva ainda pendentes;
    ///  * saídas: lançamentos 'pagar' abertos vencendo na janela;
    ///  * média histórica: receita diária de baixas nos últimos 90d × 30.
    async fn fluxo_caixa_30d(&self) -> Result<FluxoCaixaRow, DomainError> {
        sqlx::query_as::<_, FluxoCaixaRow>(
            "SELECT
                 (SELECT coalesce(sum(l.valor - l.valor_liquidado), 0)
                    FROM lancamento l
                   WHERE l.tipo = 'receber' AND l.status IN ('aberto','parcial')
                     AND l.vencimento <= CURRENT_DATE + 30)
               + (SELECT coalesce(sum(p.valor_centavos) / 100.0, 0)
                    FROM pagamento p WHERE p.status = 'pendente')
                 AS entradas_confirmadas,
                 (SELECT coalesce(sum(l.valor - l.valor_liquidado), 0)
                    FROM lancamento l
                   WHERE l.tipo = 'pagar' AND l.status IN ('aberto','parcial')
                     AND l.vencimento <= CURRENT_DATE + 30)
                 AS saidas_previstas,
                 (SELECT coalesce(sum(b.valor), 0) / 90.0 * 30.0
                    FROM baixa_lancamento b
                   WHERE b.criado_em >= now() - interval '90 days')
                 AS media_historica_90d",
        )
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)
    }

    /// Sinais por reserva futura ('p') — score montado no service.
    async fn reservas_risco(&self) -> Result<Vec<ReservaRiscoRow>, DomainError> {
        sqlx::query_as::<_, ReservaRiscoRow>(
            "SELECT r.id AS idreserva,
                 c.nome AS cliente,
                 a.nome AS acomodacao,
                 r.entradaprevista AS entrada,
                 (r.entradaprevista - CURRENT_DATE)::bigint AS dias_ate_checkin,
                 greatest(0, (CURRENT_DATE - r.criado_em::date)) AS lead_time_dias,
                 (SELECT count(*) FROM reserva x
                   WHERE x.idcliente = r.idcliente AND x.status = 'f') AS estadias_anteriores,
                 (SELECT count(*) FROM reserva x
                   WHERE x.idcliente = r.idcliente AND x.status = 'c') AS cancelamentos_anteriores,
                 (SELECT count(*) FROM reserva x
                   WHERE x.idcliente = r.idcliente AND x.id <> r.id) AS reservas_anteriores,
                 EXISTS (SELECT 1 FROM pagamento p
                          WHERE p.idreserva = r.id AND p.status = 'pago') AS tem_pagamento_pago,
                 EXISTS (SELECT 1 FROM pagamento p
                          WHERE p.idreserva = r.id AND p.status = 'pendente') AS tem_pagamento_pendente,
                 (c.telefone IS NOT NULL OR c.email IS NOT NULL) AS tem_contato
             FROM reserva r
             JOIN cliente c ON c.id = r.idcliente
             JOIN acomodacao a ON a.id = r.idacomodacao
             WHERE r.status = 'p' AND r.entradaprevista >= CURRENT_DATE
             ORDER BY r.entradaprevista",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    /// Base LTV por hóspede — estadias concluídas + consumo fechado.
    async fn perfis_hospedes(&self) -> Result<Vec<PerfilRow>, DomainError> {
        sqlx::query_as::<_, PerfilRow>(
            "SELECT c.id AS idcliente, c.nome, c.telefone, c.email,
                 count(r.id) FILTER (WHERE r.status = 'f') AS estadias,
                 max(r.saidaprevista) FILTER (WHERE r.status = 'f') AS ultima_estadia,
                 count(r.id) FILTER (WHERE r.status = 'c') AS cancelamentos,
                 coalesce(sum(r.valordiaria * (r.saidaprevista - r.entradaprevista + 1))
                          FILTER (WHERE r.status = 'f'), 0) AS receita_estadias,
                 coalesce((SELECT sum(co.valor_final)
                            FROM consumo co
                            JOIN reserva r2 ON r2.id = co.idreserva
                           WHERE r2.idcliente = c.id AND co.status = 'concluido'), 0)
                   AS receita_consumo
             FROM cliente c
             LEFT JOIN reserva r ON r.idcliente = c.id
             WHERE c.ativo
             GROUP BY c.id, c.nome, c.telefone, c.email",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    /// Ritmo de vendas: reservas criadas nos últimos 30d vs mesma janela
    /// do ano anterior (receita = diárias × valordiaria, sem canceladas).
    async fn pace(&self) -> Result<PaceRow, DomainError> {
        sqlx::query_as::<_, PaceRow>(
            "SELECT
                 count(*) FILTER (
                     WHERE criado_em >= now() - interval '30 days' AND status <> 'c'
                 ) AS reservas_atual,
                 coalesce(sum(valordiaria * (saidaprevista - entradaprevista + 1)) FILTER (
                     WHERE criado_em >= now() - interval '30 days' AND status <> 'c'
                 ), 0) AS receita_atual,
                 count(*) FILTER (
                     WHERE criado_em >= now() - interval '395 days'
                       AND criado_em <  now() - interval '365 days'
                       AND status <> 'c'
                 ) AS reservas_ano_anterior,
                 coalesce(sum(valordiaria * (saidaprevista - entradaprevista + 1)) FILTER (
                     WHERE criado_em >= now() - interval '395 days'
                       AND criado_em <  now() - interval '365 days'
                       AND status <> 'c'
                 ), 0) AS receita_ano_anterior
             FROM reserva",
        )
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)
    }

    /// Demanda diária de operação × turnos já escalados por setor.
    async fn escala_demanda_14d(&self) -> Result<Vec<EscalaDiaRow>, DomainError> {
        sqlx::query_as::<_, EscalaDiaRow>(
            "WITH dias AS (
                 SELECT generate_series(CURRENT_DATE, CURRENT_DATE + 13, '1 day')::date AS d
             )
             SELECT d AS data,
                 (SELECT count(*) FROM reserva r
                   WHERE r.status = 'p' AND r.entradaprevista = d) AS checkins,
                 (SELECT count(*) FROM reserva r
                   WHERE r.status IN ('p','i') AND r.saidaprevista = d) AS checkouts,
                 (SELECT count(*) FROM reserva r
                   WHERE r.status IN ('p','i')
                     AND r.entradaprevista < d AND r.saidaprevista > d) AS stayovers,
                 (SELECT coalesce(sum(r.quantidade_hospedes), 0) FROM reserva r
                   WHERE r.status IN ('p','i')
                     AND r.entradaprevista <= d AND r.saidaprevista >= d) AS hospedes,
                 (SELECT count(*) FROM escala_turno t
                   JOIN funcionario f ON f.id = t.idfuncionario
                   WHERE t.data = d AND f.setor = 'governanca') AS gov_escalados,
                 (SELECT count(*) FROM escala_turno t
                   JOIN funcionario f ON f.id = t.idfuncionario
                   WHERE t.data = d AND f.setor = 'recepcao') AS rec_escalados,
                 (SELECT count(*) FROM escala_turno t
                   JOIN funcionario f ON f.id = t.idfuncionario
                   WHERE t.data = d AND f.setor = 'cozinha') AS coz_escalados
             FROM dias ORDER BY d",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    /// Upgrade possível: reserva confirmada próxima + acomodação mais cara
    /// livre no mesmo período (a exclusion constraint garante o mesmo
    /// critério de ocupação da operação). Melhor alvo por reserva.
    async fn upsells(&self) -> Result<Vec<Upsell>, DomainError> {
        sqlx::query_as::<_, Upsell>(
            "SELECT DISTINCT ON (r.id)
                 r.id AS idreserva,
                 c.nome AS cliente,
                 a1.nome AS acomodacao_atual,
                 a2.nome AS acomodacao_alvo,
                 r.entradaprevista AS entrada,
                 r.saidaprevista AS saida,
                 (a2.valor - a1.valor) AS diferenca_diaria,
                 (a2.valor - a1.valor) * (r.saidaprevista - r.entradaprevista + 1)
                   AS ganho_potencial
             FROM reserva r
             JOIN cliente c ON c.id = r.idcliente
             JOIN acomodacao a1 ON a1.id = r.idacomodacao
             JOIN acomodacao a2 ON a2.ativo AND a2.valor > a1.valor
             WHERE r.status = 'p'
               AND r.entradaprevista BETWEEN CURRENT_DATE AND CURRENT_DATE + 14
               AND NOT EXISTS (
                     SELECT 1 FROM reserva x
                      WHERE x.idacomodacao = a2.id
                        AND x.status IN ('p','i')
                        AND x.periodo && r.periodo)
             ORDER BY r.id, (a2.valor - a1.valor) DESC",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    /// Saída média de estoque por item nos últimos 30d (base da projeção
    /// ajustada por ocupação prevista no service).
    async fn estoque_consumo(&self) -> Result<Vec<ItemEstoqueRow>, DomainError> {
        sqlx::query_as::<_, ItemEstoqueRow>(
            "SELECT e.id AS iditem, e.nome, e.quantidade AS saldo,
                 e.estoque_minimo,
                 coalesce((SELECT sum(m.quantidade)
                            FROM movimento_estoque m
                           WHERE m.iditem = e.id AND m.tipo = 'saida'
                             AND m.criado_em >= now() - interval '30 days'), 0)
                   AS consumo_30d
             FROM estoque e
             WHERE e.ativo
             ORDER BY e.nome",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    /// Quartos: noites ocupadas 90d + OS no período + OS ainda abertas.
    async fn risco_quartos(&self) -> Result<Vec<RiscoQuartoRow>, DomainError> {
        sqlx::query_as::<_, RiscoQuartoRow>(
            "SELECT q.id AS idquarto, q.numero, a.nome AS acomodacao,
                 coalesce((SELECT sum(r.saidaprevista - r.entradaprevista + 1)
                            FROM reserva r
                           WHERE r.idquarto = q.id AND r.status IN ('i','f')
                             AND r.entradaprevista >= CURRENT_DATE - 90), 0) AS noites_90d,
                 (SELECT count(*) FROM manutencao_ordem m
                   WHERE m.idquarto = q.id
                     AND m.aberta_em >= now() - interval '90 days') AS os_90d,
                 (SELECT count(*) FROM manutencao_ordem m
                   WHERE m.idquarto = q.id
                     AND m.status IN ('aberta','em_execucao','aguardando_peca')) AS os_abertas
             FROM quarto q
             JOIN acomodacao a ON a.id = q.idacomodacao
             WHERE q.ativo
             ORDER BY q.numero",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    /// Indicadores mensais 12m — diárias vendidas, receita, nº reservas,
    /// ocupação % e ADR calculados em SQL (total de quartos constante).
    async fn historico_12m(&self) -> Result<Vec<MesHistorico>, DomainError> {
        sqlx::query_as::<_, MesHistorico>(
            "WITH meses AS (
                 SELECT generate_series(
                     date_trunc('month', CURRENT_DATE) - interval '11 months',
                     date_trunc('month', CURRENT_DATE),
                     '1 month')::date AS m
             ), diarias AS (
                 SELECT date_trunc('month', n)::date AS mes,
                     count(*) AS diarias,
                     sum(r.valordiaria) AS receita
                 FROM reserva r
                 JOIN LATERAL generate_series(r.entradaprevista, r.saidaprevista, '1 day') n ON true
                 WHERE r.status IN ('i','f')
                   AND n >= date_trunc('month', CURRENT_DATE) - interval '11 months'
                 GROUP BY 1
             ), reservas AS (
                 SELECT date_trunc('month', r.entradaprevista)::date AS mes,
                     count(*) AS total
                 FROM reserva r
                 WHERE r.status IN ('i','f')
                   AND r.entradaprevista >= date_trunc('month', CURRENT_DATE) - interval '11 months'
                 GROUP BY 1
             )
             SELECT m.m AS mes,
                 coalesce(d.diarias, 0) AS diarias,
                 coalesce(d.receita, 0) AS receita,
                 coalesce(rv.total, 0) AS reservas,
                 coalesce(round(coalesce(d.diarias, 0)::numeric * 100.0 /
                     nullif((SELECT count(*) FROM acomodacao WHERE ativo) *
                            extract(day FROM m.m + interval '1 month' - interval '1 day'), 0), 1), 0)
                   AS ocupacao_pct,
                 coalesce(round(coalesce(d.receita, 0) / nullif(d.diarias, 0), 2), 0) AS adr
             FROM meses m
             LEFT JOIN diarias d ON d.mes = m.m
             LEFT JOIN reservas rv ON rv.mes = m.m
             ORDER BY m.m",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }
}
