use super::audit;
use crate::persistence::db::map_db_err;
use async_trait::async_trait;
use chrono::{DateTime, NaiveDate, Utc};
use clarituz_domain::entities::{
    Acompanhante, AdicionalConsumo, Bloqueio, Consumo, Fnrh, Grupo, GrupoUnidadeView,
    ItemConsumido, NovoLog, Reembolso, Reserva,
};
use clarituz_domain::enums::StatusConsumo;
use clarituz_domain::ports::{
    AcompanhanteRepository, ComandoCheckout, FiltroReserva, FnrhRepository, NovaFnrh, NovaReserva,
    NovoAcompanhante, NovoAdicional, NovoItemConsumido, ReservaRepository, ResultadoCancelamento,
};
use clarituz_domain::queries::{
    AcomodacaoDisponivel, ComprovanteResumo, ConsumoResumo, MapaQuarto, PendenciaReserva,
    PendenciasFechamento, ReservaDetalhe, ReservaResumo,
};
use clarituz_domain::value_objects::PeriodoEstadia;
use clarituz_domain::DomainError;
use clarituz_shared::{Page, PageParams};
use rust_decimal::Decimal;
use sqlx::PgPool;

#[derive(Clone)]
pub struct PgReservaRepository {
    pool: PgPool,
}

impl PgReservaRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

const RESERVA_COLS: &str = "id, idacomodacao, idcliente, idquarto, quantidade_hospedes,
    entradaprevista, saidaprevista, checkin_em, checkout_em, obs, status,
    valordiaria, expira_em, token_publico, early_checkin, late_checkout,
    idoperadora, idcontrato, criado_em, atualizado_em";

const CONSUMO_COLS: &str = "id, idreserva, valor_estadia, valor_itens, valor_adicional,
    total_desconto, valor_final, idforma_pagamento, comprovante, status, fechado_em,
    criado_em, atualizado_em";

const RESUMO_SEL: &str = "
    r.id, r.idacomodacao, a.nome AS acomodacao_nome, a.numero AS acomodacao_numero,
    a.cor AS acomodacao_cor, r.idcliente, c.nome AS cliente_nome,
    r.quantidade_hospedes, r.entradaprevista, r.saidaprevista, r.status,
    r.valordiaria, r.idquarto, q.numero AS quarto_numero, con.valor_estadia,
    r.fnrh_preenchida_em";

const RESUMO_FROM: &str = "
    FROM reserva r
    JOIN acomodacao a ON a.id = r.idacomodacao
    JOIN cliente c ON c.id = r.idcliente
    LEFT JOIN quarto q ON q.id = r.idquarto
    LEFT JOIN consumo con ON con.idreserva = r.id";

#[async_trait]
impl ReservaRepository for PgReservaRepository {
    async fn buscar(&self, id: i64) -> Result<Option<Reserva>, DomainError> {
        sqlx::query_as::<_, Reserva>(&format!("SELECT {RESERVA_COLS} FROM reserva WHERE id = $1"))
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map_err(map_db_err)
    }

    async fn buscar_detalhe(&self, id: i64) -> Result<Option<ReservaDetalhe>, DomainError> {
        let mut det = sqlx::query_as::<_, ReservaDetalhe>(
            "SELECT r.id, r.idacomodacao, r.idcliente, r.idquarto, q.numero AS quarto_numero,
                    r.quantidade_hospedes, r.entradaprevista, r.saidaprevista,
                    r.checkin_em, r.checkout_em, r.obs, r.status, r.valordiaria, r.criado_em,
                    a.nome AS acomodacao_nome, a.numero AS acomodacao_numero, a.valor AS acomodacao_valor,
                    c.nome AS cliente_nome, c.cpf AS cliente_cpf,
                    c.email AS cliente_email, c.telefone AS cliente_telefone,
                    r.expira_em, r.fnrh_hospede, r.fnrh_preenchida_em,
                    r.fnrh_documento_key
             FROM reserva r
             JOIN acomodacao a ON a.id = r.idacomodacao
             JOIN cliente c ON c.id = r.idcliente
             LEFT JOIN quarto q ON q.id = r.idquarto
             WHERE r.id = $1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)?;

        if let Some(d) = det.as_mut() {
            d.consumo = sqlx::query_as::<_, ConsumoResumo>(
                "SELECT c.id, c.status, c.valor_estadia, c.valor_itens, c.valor_adicional,
                        c.total_desconto, c.valor_final, c.idforma_pagamento,
                        fp.nome AS forma_pagamento, c.comprovante, c.fechado_em
                 FROM consumo c LEFT JOIN forma_pagamento fp ON fp.id = c.idforma_pagamento
                 WHERE c.idreserva = $1",
            )
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map_err(map_db_err)?;
        }
        Ok(det)
    }

    async fn listar(
        &self,
        filtro: &FiltroReserva,
        page: PageParams,
    ) -> Result<Page<ReservaResumo>, DomainError> {
        // parâmetros opcionais posicionais: NULL desativa o filtro
        const WHERE: &str = "
            WHERE ($1::bigint IS NULL OR r.idacomodacao = $1)
              AND ($2::bigint IS NULL OR r.idcliente = $2)
              AND ($3::reserva_status IS NULL OR r.status = $3)
              AND ($4::date IS NULL OR r.saidaprevista >= $4)
              AND ($5::date IS NULL OR r.entradaprevista <= $5)
              AND ($6::text IS NULL OR c.nome ILIKE '%' || $6 || '%'
                   OR c.cpf ILIKE '%' || $6 || '%'
                   OR a.nome ILIKE '%' || $6 || '%'
                   OR a.numero::text ILIKE '%' || $6 || '%'
                   OR r.id::text = $6)";

        let status = filtro.status;
        let ini = filtro.periodo.map(|p| p.entrada);
        let fim = filtro.periodo.map(|p| p.saida);
        let busca = filtro.busca.as_deref().map(str::trim);

        let total = sqlx::query_scalar::<_, i64>(&format!("SELECT COUNT(*) {RESUMO_FROM} {WHERE}"))
            .bind(filtro.idacomodacao)
            .bind(filtro.idcliente)
            .bind(status)
            .bind(ini)
            .bind(fim)
            .bind(busca)
            .fetch_one(&self.pool)
            .await
            .map_err(map_db_err)?;

        let items = sqlx::query_as::<_, ReservaResumo>(&format!(
            "SELECT {RESUMO_SEL} {RESUMO_FROM} {WHERE}
             ORDER BY r.entradaprevista DESC, r.id DESC LIMIT $7 OFFSET $8"
        ))
        .bind(filtro.idacomodacao)
        .bind(filtro.idcliente)
        .bind(status)
        .bind(ini)
        .bind(fim)
        .bind(busca)
        .bind(page.limit())
        .bind(page.offset())
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)?;

        Ok(Page::new(items, page, total))
    }

    async fn listar_eventos(
        &self,
        periodo: Option<PeriodoEstadia>,
    ) -> Result<Vec<ReservaResumo>, DomainError> {
        sqlx::query_as::<_, ReservaResumo>(&format!(
            "SELECT {RESUMO_SEL} {RESUMO_FROM}
             WHERE ($1::date IS NULL OR $2::date IS NULL OR
                    NOT (r.saidaprevista < $1 OR r.entradaprevista > $2))
               AND r.status != 'c'
             ORDER BY r.entradaprevista"
        ))
        .bind(periodo.map(|p| p.entrada))
        .bind(periodo.map(|p| p.saida))
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn disponibilidade(
        &self,
        periodo: PeriodoEstadia,
        hospedes: Option<i32>,
        idacomodacao: Option<i64>,
        excluir_reserva: Option<i64>,
    ) -> Result<Vec<AcomodacaoDisponivel>, DomainError> {
        sqlx::query_as::<_, AcomodacaoDisponivel>(
            "SELECT a.id, a.nome, a.numero,
                    COALESCE((SELECT t.valor FROM tarifa_ocupacao t
                               WHERE t.idtipo_acomodacao = a.idtipo_acomodacao
                                 AND t.hospedes <= $3
                               ORDER BY t.hospedes DESC LIMIT 1),
                             a.valor) AS valor,
                    a.capacidade
             FROM acomodacao a
             WHERE a.ativo
               AND ($4::bigint IS NULL OR a.id = $4)
               AND NOT EXISTS (
                   SELECT 1 FROM reserva r
                   WHERE r.idacomodacao = a.id
                     AND r.status IN ('p', 'i')
                     AND r.periodo && daterange($1, $2, '[]')
                     AND ($5::bigint IS NULL OR r.id != $5)
               )
               AND NOT EXISTS (
                   SELECT 1 FROM bloqueio b
                   WHERE b.idacomodacao = a.id
                     AND daterange(b.inicio, b.fim, '[]') && daterange($1, $2, '[]')
               )
             ORDER BY a.nome, a.numero",
        )
        .bind(periodo.entrada)
        .bind(periodo.saida)
        .bind(hospedes)
        .bind(idacomodacao)
        .bind(excluir_reserva)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    /// Soma noite a noite — cada dia resolve tarifa_periodo (maior
    /// prioridade; empate vai pro registro mais recente) e, na ausência
    /// dela, a faixa de ocupação do tipo; sem nenhuma, a tarifa base.
    async fn precos_estadia(
        &self,
        periodo: PeriodoEstadia,
        hospedes: i32,
        idacomodacoes: &[i64],
    ) -> Result<std::collections::HashMap<i64, Decimal>, DomainError> {
        if idacomodacoes.is_empty() {
            return Ok(std::collections::HashMap::new());
        }
        sqlx::query_as::<_, (i64, Decimal)>(
            "WITH noites AS (
                 SELECT generate_series($2::date, $3::date - 1, '1 day'::interval)::date AS dia
             )
             SELECT a.id,
                    SUM(COALESCE(
                        (SELECT tp.valor FROM tarifa_periodo tp
                          WHERE tp.idacomodacao = a.id
                            AND noites.dia BETWEEN tp.inicio AND tp.fim
                          ORDER BY tp.prioridade DESC, tp.id DESC LIMIT 1),
                        (SELECT t.valor FROM tarifa_ocupacao t
                          WHERE t.idtipo_acomodacao = a.idtipo_acomodacao
                            AND t.hospedes <= $4
                          ORDER BY t.hospedes DESC LIMIT 1),
                        a.valor)) AS total
             FROM acomodacao a
             CROSS JOIN noites
             WHERE a.id = ANY($1)
             GROUP BY a.id",
        )
        .bind(idacomodacoes)
        .bind(periodo.entrada)
        .bind(periodo.saida)
        .bind(hospedes)
        .fetch_all(&self.pool)
        .await
        .map(|rows| rows.into_iter().collect())
        .map_err(map_db_err)
    }

    async fn mapa_quartos(&self) -> Result<Vec<MapaQuarto>, DomainError> {
        // Uma linha por acomodação física ativa — ocupação por reserva,
        // limpeza/manutenção via quartos vinculados.
        sqlx::query_as::<_, MapaQuarto>(
            "SELECT a.id, a.nome, a.numero, a.andar, a.cor,
                    ta.nome AS tipo,
                    (SELECT r.id FROM reserva r
                      WHERE r.idacomodacao = a.id AND r.status IN ('p','i')
                        AND r.periodo && daterange(CURRENT_DATE, CURRENT_DATE + 1, '[]')
                      LIMIT 1) AS idreserva_hoje,
                    (SELECT r.status::text FROM reserva r
                      WHERE r.idacomodacao = a.id AND r.status IN ('p','i')
                        AND r.periodo && daterange(CURRENT_DATE, CURRENT_DATE + 1, '[]')
                      LIMIT 1) AS status_hoje,
                    EXISTS(SELECT 1 FROM bloqueio b
                      WHERE b.idacomodacao = a.id
                        AND daterange(b.inicio, b.fim, '[]') @> CURRENT_DATE) AS bloqueado,
                    (SELECT count(*) FROM quarto q
                      JOIN governanca_tarefa g ON g.idquarto = q.id
                       AND g.data = CURRENT_DATE
                       AND g.status IN ('pendente','em_andamento')
                      WHERE q.idacomodacao = a.id) AS limpeza_pendente,
                    (SELECT count(*) FROM quarto q
                      JOIN manutencao_ordem m ON m.idquarto = q.id
                       AND m.status IN ('aberta','em_execucao','aguardando_peca')
                      WHERE q.idacomodacao = a.id) AS manut_aberta
             FROM acomodacao a
             LEFT JOIN tipo_acomodacao ta ON ta.id = a.idtipo_acomodacao
             WHERE a.ativo
             ORDER BY a.andar, a.numero",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn pendencias_fechamento(&self) -> Result<PendenciasFechamento, DomainError> {
        let no_shows = sqlx::query_as::<_, PendenciaReserva>(
            "SELECT r.id, c.nome AS cliente_nome, a.nome AS acomodacao_nome,
                    r.entradaprevista, r.saidaprevista,
                    (CURRENT_DATE - r.entradaprevista)::int AS dias_atraso
             FROM reserva r
             JOIN cliente c ON c.id = r.idcliente
             JOIN acomodacao a ON a.id = r.idacomodacao
             WHERE r.status = 'p' AND r.entradaprevista < CURRENT_DATE
             ORDER BY r.entradaprevista",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)?;

        let checkouts = sqlx::query_as::<_, PendenciaReserva>(
            "SELECT r.id, c.nome AS cliente_nome, a.nome AS acomodacao_nome,
                    r.entradaprevista, r.saidaprevista,
                    (CURRENT_DATE - r.saidaprevista)::int AS dias_atraso
             FROM reserva r
             JOIN cliente c ON c.id = r.idcliente
             JOIN acomodacao a ON a.id = r.idacomodacao
             WHERE r.status = 'i' AND r.saidaprevista <= CURRENT_DATE
             ORDER BY r.saidaprevista",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)?;

        let contas: (i64, rust_decimal::Decimal) = sqlx::query_as(
            "SELECT count(*)::bigint, coalesce(sum(valor_estadia + valor_itens + valor_adicional), 0)
             FROM consumo WHERE status = 'pendente'",
        )
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)?;

        Ok(PendenciasFechamento {
            no_shows,
            checkouts_pendentes: checkouts,
            contas_abertas: contas.0,
            contas_total: contas.1,
        })
    }

    async fn bloqueio_criar(
        &self,
        idacomodacao: i64,
        inicio: chrono::NaiveDate,
        fim: chrono::NaiveDate,
        motivo: &str,
        criado_por: i64,
    ) -> Result<Bloqueio, DomainError> {
        sqlx::query_as::<_, Bloqueio>(
            "INSERT INTO bloqueio (idacomodacao, inicio, fim, motivo, criado_por)
             VALUES ($1, $2, $3, $4, $5) RETURNING *",
        )
        .bind(idacomodacao)
        .bind(inicio)
        .bind(fim)
        .bind(motivo)
        .bind(criado_por)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn bloqueio_listar(&self) -> Result<Vec<Bloqueio>, DomainError> {
        sqlx::query_as::<_, Bloqueio>(
            "SELECT * FROM bloqueio WHERE fim >= CURRENT_DATE ORDER BY inicio, idacomodacao",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn bloqueio_remover(&self, id: i64) -> Result<(), DomainError> {
        sqlx::query("DELETE FROM bloqueio WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(map_db_err)?;
        Ok(())
    }

    async fn grupo_criar(
        &self,
        nome: &str,
        contato: Option<&str>,
        obs: Option<&str>,
        inicio: NaiveDate,
        fim: NaiveDate,
        unidades: &[i64],
        bloquear: bool,
        criado_por: i64,
    ) -> Result<Grupo, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let grupo = sqlx::query_as::<_, Grupo>(
            "INSERT INTO grupo (nome, contato, obs, inicio, fim, criado_por)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, nome, contato, obs, inicio, fim, criado_por, criado_em",
        )
        .bind(nome)
        .bind(contato)
        .bind(obs)
        .bind(inicio)
        .bind(fim)
        .bind(criado_por)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;
        for ida in unidades {
            sqlx::query("INSERT INTO grupo_unidade (idgrupo, idacomodacao) VALUES ($1, $2)")
                .bind(grupo.id)
                .bind(ida)
                .execute(&mut *tx)
                .await
                .map_err(map_db_err)?;
            if bloquear {
                sqlx::query(
                    "INSERT INTO bloqueio (idacomodacao, inicio, fim, motivo, criado_por, idgrupo)
                     VALUES ($1, $2, $3, $4, $5, $6)",
                )
                .bind(ida)
                .bind(inicio)
                .bind(fim)
                .bind(format!("Grupo {nome}"))
                .bind(criado_por)
                .bind(grupo.id)
                .execute(&mut *tx)
                .await
                .map_err(map_db_err)?;
            }
        }
        tx.commit().await.map_err(map_db_err)?;
        Ok(grupo)
    }

    async fn grupo_listar(&self) -> Result<Vec<Grupo>, DomainError> {
        sqlx::query_as::<_, Grupo>(
            "SELECT id, nome, contato, obs, inicio, fim, criado_por, criado_em
             FROM grupo ORDER BY inicio DESC",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn grupo_unidades(&self, idgrupo: i64) -> Result<Vec<GrupoUnidadeView>, DomainError> {
        sqlx::query_as::<_, GrupoUnidadeView>(
            "SELECT gu.id, gu.idacomodacao, a.nome AS acomodacao_nome, a.numero AS acomodacao_numero,
                    r.id AS idreserva, cl.nome AS hospede, r.status::text AS reserva_status
             FROM grupo_unidade gu
             JOIN acomodacao a ON a.id = gu.idacomodacao
             LEFT JOIN reserva r ON r.idgrupo = gu.idgrupo AND r.idacomodacao = gu.idacomodacao
                AND r.status IN ('p','i')
             LEFT JOIN cliente cl ON cl.id = r.idcliente
             WHERE gu.idgrupo = $1
             ORDER BY a.andar, a.numero",
        )
        .bind(idgrupo)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn grupo_remover(&self, id: i64) -> Result<(), DomainError> {
        sqlx::query("DELETE FROM grupo WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(map_db_err)?;
        Ok(())
    }

    async fn reserva_vincular_grupo(
        &self,
        idreserva: i64,
        idgrupo: Option<i64>,
    ) -> Result<(), DomainError> {
        sqlx::query("UPDATE reserva SET idgrupo = $2 WHERE id = $1")
            .bind(idreserva)
            .bind(idgrupo)
            .execute(&self.pool)
            .await
            .map_err(map_db_err)?;
        Ok(())
    }

    async fn criar(&self, nova: &NovaReserva, log: NovoLog) -> Result<Reserva, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;

        let reserva = sqlx::query_as::<_, Reserva>(&format!(
            "INSERT INTO reserva
                (idacomodacao, idcliente, quantidade_hospedes, entradaprevista,
                 saidaprevista, obs, status, valordiaria, expira_em, early_checkin,
                 late_checkout, idoperadora, idcontrato)
             VALUES ($1, $2, $3, $4, $5, $6, 'p', $7, $8, $9, $10, $11, $12)
             RETURNING {RESERVA_COLS}"
        ))
        .bind(nova.idacomodacao)
        .bind(nova.idcliente)
        .bind(nova.quantidade_hospedes)
        .bind(nova.periodo.entrada)
        .bind(nova.periodo.saida)
        .bind(&nova.obs)
        .bind(nova.valordiaria)
        .bind(nova.expira_em)
        .bind(nova.early_checkin)
        .bind(nova.late_checkout)
        .bind(nova.idoperadora)
        .bind(nova.idcontrato)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?; // 23P01 → Conflito (overbooking impossível)

        sqlx::query(
            "INSERT INTO consumo (idreserva, valor_estadia, status) VALUES ($1, $2, 'pendente')",
        )
        .bind(reserva.id)
        .bind(nova.valor_total)
        .execute(&mut *tx)
        .await
        .map_err(map_db_err)?;

        let mut log = log;
        log.idtabela = reserva.id;
        audit::gravar(&mut *tx, &log).await?;

        tx.commit().await.map_err(map_db_err)?;
        Ok(reserva)
    }

    async fn remanejar(
        &self,
        id: i64,
        idacomodacao: i64,
        periodo: &PeriodoEstadia,
        valor_total: Decimal,
        log: NovoLog,
    ) -> Result<Reserva, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;

        // `AND status = 'p'`: check-in ou cancelamento concorrente anula o
        // remanejo — a linha some do RETURNING e vira Conflito legível.
        // 23P01 do constraint de overlap → Conflito (map_db_err).
        let reserva = sqlx::query_as::<_, Reserva>(&format!(
            "UPDATE reserva SET idacomodacao = $2, entradaprevista = $3,
                saidaprevista = $4
             WHERE id = $1 AND status = 'p'
             RETURNING {RESERVA_COLS}"
        ))
        .bind(id)
        .bind(idacomodacao)
        .bind(periodo.entrada)
        .bind(periodo.saida)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| {
            DomainError::conflito("A reserva não está mais pendente — atualize o calendário.")
        })?;

        sqlx::query(
            "UPDATE consumo SET valor_estadia = $2
             WHERE idreserva = $1 AND status = 'pendente'",
        )
        .bind(id)
        .bind(valor_total)
        .execute(&mut *tx)
        .await
        .map_err(map_db_err)?;

        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(reserva)
    }

    async fn reserva_por_token(&self, token: uuid::Uuid) -> Result<Option<i64>, DomainError> {
        sqlx::query_scalar::<_, i64>("SELECT id FROM reserva WHERE token_publico = $1")
            .bind(token)
            .fetch_optional(&self.pool)
            .await
            .map_err(map_db_err)
    }

    async fn aplicar_extra(
        &self,
        idreserva: i64,
        contexto: &serde_json::Value,
        valor_centavos: i64,
        log: NovoLog,
    ) -> Result<(), DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        match contexto["oferta"].as_str() {
            Some("early_checkin") => {
                sqlx::query(
                    "UPDATE reserva SET early_checkin = true
                     WHERE id = $1 AND status IN ('p','i')",
                )
                .bind(idreserva)
                .execute(&mut *tx)
                .await
                .map_err(map_db_err)?;
            }
            Some("late_checkout") => {
                sqlx::query(
                    "UPDATE reserva SET late_checkout = true
                     WHERE id = $1 AND status IN ('p','i')",
                )
                .bind(idreserva)
                .execute(&mut *tx)
                .await
                .map_err(map_db_err)?;
            }
            Some("upgrade") => {
                let destino = contexto["idacomodacao"]
                    .as_i64()
                    .ok_or_else(|| DomainError::validacao("Upgrade sem acomodação de destino."))?;
                // Só reserva ainda pendente troca de unidade (check-in já
                // atribuiu quarto físico); a exclusão de overlap rejeita
                // destino ocupado no período → Conflito.
                let ok = sqlx::query(
                    "UPDATE reserva SET idacomodacao = $2
                     WHERE id = $1 AND status = 'p'",
                )
                .bind(idreserva)
                .bind(destino)
                .execute(&mut *tx)
                .await
                .map_err(map_db_err)?
                .rows_affected();
                if ok == 0 {
                    return Err(DomainError::conflito(
                        "A reserva não está mais pendente — o upgrade não foi aplicado.",
                    ));
                }
            }
            _ => return Err(DomainError::validacao("Oferta de extra desconhecida.").into()),
        }
        // Receita do extra entra como adicional da conta — `valor_final`
        // é derivado das partes no fechamento; relatórios leem `consumo`.
        sqlx::query(
            "UPDATE consumo SET valor_adicional = valor_adicional + $2
             WHERE idreserva = $1 AND status = 'pendente'",
        )
        .bind(idreserva)
        .bind(Decimal::from(valor_centavos) / Decimal::from(100))
        .execute(&mut *tx)
        .await
        .map_err(map_db_err)?;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(())
    }

    async fn checkin(
        &self,
        id: i64,
        em: DateTime<Utc>,
        log: NovoLog,
    ) -> Result<Reserva, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;

        // FOR UPDATE: serializa check-ins concorrentes na mesma reserva
        let mut reserva = sqlx::query_as::<_, Reserva>(&format!(
            "SELECT {RESERVA_COLS} FROM reserva WHERE id = $1 FOR UPDATE"
        ))
        .bind(id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| DomainError::nao_encontrado("Reserva não encontrada."))?;

        // Atribui quarto físico livre do tipo — mesmo critério do legado.
        let idquarto = sqlx::query_scalar::<_, i64>(
            "SELECT q.id FROM quarto q
             WHERE q.idacomodacao = $1 AND q.ativo
               AND NOT EXISTS (
                   SELECT 1 FROM reserva r
                   WHERE r.idquarto = q.id AND r.status IN ('p','i') AND r.id != $2
                     AND NOT (r.saidaprevista < $3 OR r.entradaprevista > $4)
               )
             ORDER BY q.numero LIMIT 1",
        )
        .bind(reserva.idacomodacao)
        .bind(reserva.id)
        .bind(reserva.entradaprevista)
        .bind(reserva.saidaprevista)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?;

        // máquina de estados do domínio decide
        reserva.checkin(idquarto, em)?;

        sqlx::query(
            "UPDATE reserva SET status = 'i', checkin_em = $2, idquarto = $3, atualizado_em = now()
             WHERE id = $1",
        )
        .bind(id)
        .bind(em)
        .bind(idquarto)
        .execute(&mut *tx)
        .await
        .map_err(map_db_err)?;

        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(reserva)
    }

    async fn checkout(
        &self,
        cmd: &ComandoCheckout,
        em: DateTime<Utc>,
        log: NovoLog,
    ) -> Result<(Reserva, Consumo), DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;

        let mut reserva = sqlx::query_as::<_, Reserva>(&format!(
            "SELECT {RESERVA_COLS} FROM reserva WHERE id = $1 FOR UPDATE"
        ))
        .bind(cmd.idreserva)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| DomainError::nao_encontrado("Reserva não encontrada."))?;

        let consumo = sqlx::query_as::<_, Consumo>(&format!(
            "SELECT {CONSUMO_COLS} FROM consumo WHERE idreserva = $1 FOR UPDATE"
        ))
        .bind(cmd.idreserva)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| DomainError::nao_encontrado("Conta de consumo não encontrada."))?;

        reserva.checkout(em)?;
        if !consumo.status.aberto() {
            return Err(DomainError::conflito(
                "Consumo da reserva já foi concluído ou cancelado.",
            ));
        }

        // lançamentos avulsos
        for ad in &cmd.adicionais {
            sqlx::query(
                "INSERT INTO adicional_consumo (idconsumo, motivo, valor) VALUES ($1,$2,$3)",
            )
            .bind(consumo.id)
            .bind(&ad.motivo)
            .bind(ad.valor)
            .execute(&mut *tx)
            .await
            .map_err(map_db_err)?;
        }

        let consumo_fechado = sqlx::query_as::<_, Consumo>(&format!(
            "UPDATE consumo SET
                status = 'concluido',
                valor_estadia = $2,
                valor_adicional = valor_adicional + $3,
                valor_final = $4,
                total_desconto = $5,
                idforma_pagamento = $6,
                comprovante = $7,
                fechado_em = $8,
                atualizado_em = now()
             WHERE id = $1 RETURNING {CONSUMO_COLS}"
        ))
        .bind(consumo.id)
        .bind(cmd.valor_estadia)
        .bind(
            cmd.adicionais
                .iter()
                .fold(Decimal::ZERO, |a, x| a + x.valor),
        )
        .bind(cmd.valor_final)
        .bind(cmd.total_desconto)
        .bind(cmd.idforma_pagamento)
        .bind(&cmd.comprovante)
        .bind(em)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;

        sqlx::query(
            "UPDATE reserva SET status = 'f', checkout_em = $2, atualizado_em = now() WHERE id = $1",
        )
        .bind(cmd.idreserva)
        .bind(em)
        .execute(&mut *tx)
        .await
        .map_err(map_db_err)?;

        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok((reserva, consumo_fechado))
    }

    async fn cancelar(
        &self,
        id: i64,
        motivo: Option<&str>,
        idfuncionario: Option<i64>,
        log: NovoLog,
    ) -> Result<ResultadoCancelamento, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;

        let mut reserva = sqlx::query_as::<_, Reserva>(&format!(
            "SELECT {RESERVA_COLS} FROM reserva WHERE id = $1 FOR UPDATE"
        ))
        .bind(id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| DomainError::nao_encontrado("Reserva não encontrada."))?;

        reserva.cancelar()?;

        let consumo = sqlx::query_as::<_, Consumo>(&format!(
            "SELECT {CONSUMO_COLS} FROM consumo WHERE idreserva = $1 FOR UPDATE"
        ))
        .bind(id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?;

        sqlx::query("UPDATE reserva SET status = 'c', atualizado_em = now() WHERE id = $1")
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(map_db_err)?;

        // compensação: pendente → cancelado; concluído → reembolsado + lançamento
        let mut reembolso = None;
        if let Some(c) = consumo {
            let (novo_status, valor_reembolso) = match c.status {
                StatusConsumo::Concluido => (
                    StatusConsumo::Reembolsado,
                    c.valor_final
                        .filter(|v| *v > Decimal::ZERO)
                        .unwrap_or(c.valor_estadia),
                ),
                _ => (StatusConsumo::Cancelado, Decimal::ZERO),
            };

            sqlx::query("UPDATE consumo SET status = $2, atualizado_em = now() WHERE id = $1")
                .bind(c.id)
                .bind(novo_status)
                .execute(&mut *tx)
                .await
                .map_err(map_db_err)?;

            if novo_status == StatusConsumo::Reembolsado && valor_reembolso > Decimal::ZERO {
                reembolso = Some(
                    sqlx::query_as::<_, Reembolso>(
                        "INSERT INTO reembolso (idconsumo, idreserva, idfuncionario, valor, motivo)
                         VALUES ($1, $2, $3, $4, $5)
                         RETURNING id, idconsumo, idreserva, idfuncionario, valor, motivo, criado_em",
                    )
                    .bind(c.id)
                    .bind(id)
                    .bind(idfuncionario)
                    .bind(valor_reembolso)
                    .bind(motivo)
                    .fetch_one(&mut *tx)
                    .await
                    .map_err(map_db_err)?,
                );
            }
        }

        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(ResultadoCancelamento { reserva, reembolso })
    }

    async fn registrar_item_consumido(
        &self,
        novo: &NovoItemConsumido,
        idfuncionario: i64,
        log: NovoLog,
    ) -> Result<ItemConsumido, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;

        // 1) destrava e debita o item do frigobar (FOR UPDATE evita perda de update)
        let frig_item = sqlx::query_as::<_, (i64, i64, i32)>(
            "SELECT id, iditem, quantidade FROM item_frigobar
             WHERE id = $1 AND ativo FOR UPDATE",
        )
        .bind(novo.iditem_frigobar)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| DomainError::nao_encontrado("Item do frigobar não encontrado."))?;

        let (id_item_frigobar, iditem, qtd_atual) = frig_item;
        if novo.quantidade > qtd_atual {
            return Err(DomainError::regra("Quantidade insuficiente no frigobar."));
        }

        // nome + preço reais do estoque — nunca do cliente
        let (nome_item, valor_unitario) = sqlx::query_as::<_, (String, Decimal)>(
            "SELECT nome, valor_unitario FROM estoque WHERE id = $1",
        )
        .bind(iditem)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;

        sqlx::query("UPDATE item_frigobar SET quantidade = quantidade - $2 WHERE id = $1")
            .bind(id_item_frigobar)
            .bind(novo.quantidade)
            .execute(&mut *tx)
            .await
            .map_err(map_db_err)?;

        sqlx::query(
            "INSERT INTO movimento_estoque (iditem, tipo, quantidade, idfuncionario, motivo)
             VALUES ($1, 'saida', $2, $3, 'venda frigobar')",
        )
        .bind(iditem)
        .bind(novo.quantidade)
        .bind(idfuncionario)
        .execute(&mut *tx)
        .await
        .map_err(map_db_err)?;

        let valor_total = (valor_unitario * Decimal::from(novo.quantidade)).round_dp(2);
        let item = sqlx::query_as::<_, ItemConsumido>(
            "INSERT INTO item_consumido (idconsumo, iditem, nome, quantidade, valor_total)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, idconsumo, iditem, nome, quantidade, valor_total, criado_em",
        )
        .bind(novo.idconsumo)
        .bind(iditem)
        .bind(&nome_item)
        .bind(novo.quantidade)
        .bind(valor_total)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;

        // recalcula o total da conta — fonte única de verdade
        sqlx::query(
            "UPDATE consumo SET
                valor_itens = valor_itens + $2,
                valor_final = valor_estadia + valor_itens + $2 + valor_adicional - total_desconto,
                atualizado_em = now()
             WHERE id = $1 AND status = 'pendente'",
        )
        .bind(novo.idconsumo)
        .bind(valor_total)
        .execute(&mut *tx)
        .await
        .map_err(map_db_err)?;

        let mut log = log;
        log.idtabela = item.id;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(item)
    }

    async fn listar_itens_consumidos(
        &self,
        idconsumo: i64,
    ) -> Result<Vec<ItemConsumido>, DomainError> {
        sqlx::query_as::<_, ItemConsumido>(
            "SELECT id, idconsumo, iditem, nome, quantidade, valor_total, criado_em
             FROM item_consumido WHERE idconsumo = $1 ORDER BY id",
        )
        .bind(idconsumo)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn listar_adicionais(
        &self,
        idconsumo: i64,
    ) -> Result<Vec<AdicionalConsumo>, DomainError> {
        sqlx::query_as::<_, AdicionalConsumo>(
            "SELECT id, idconsumo, motivo, valor, criado_em
             FROM adicional_consumo WHERE idconsumo = $1 ORDER BY id",
        )
        .bind(idconsumo)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn lancar_adicional(
        &self,
        idconsumo: i64,
        adicional: &NovoAdicional,
        log: NovoLog,
    ) -> Result<AdicionalConsumo, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let ad = sqlx::query_as::<_, AdicionalConsumo>(
            "INSERT INTO adicional_consumo (idconsumo, motivo, valor) VALUES ($1,$2,$3)
             RETURNING id, idconsumo, motivo, valor, criado_em",
        )
        .bind(idconsumo)
        .bind(&adicional.motivo)
        .bind(adicional.valor)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;
        sqlx::query(
            "UPDATE consumo SET valor_adicional = valor_adicional + $2,
             atualizado_em = now() WHERE id = $1",
        )
        .bind(idconsumo)
        .bind(adicional.valor)
        .execute(&mut *tx)
        .await
        .map_err(map_db_err)?;
        let mut log = log;
        log.idtabela = ad.id;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(ad)
    }

    async fn consumo_da_reserva(&self, idreserva: i64) -> Result<Option<Consumo>, DomainError> {
        sqlx::query_as::<_, Consumo>(&format!(
            "SELECT {CONSUMO_COLS} FROM consumo WHERE idreserva = $1"
        ))
        .bind(idreserva)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn contar_por_acomodacao(
        &self,
        periodo: Option<PeriodoEstadia>,
    ) -> Result<Vec<(String, i64)>, DomainError> {
        sqlx::query_as::<_, (String, i64)>(
            "SELECT a.nome, COUNT(r.id)
             FROM acomodacao a
             LEFT JOIN reserva r ON r.idacomodacao = a.id AND r.status != 'c'
                AND ($1::date IS NULL OR $2::date IS NULL OR
                     NOT (r.saidaprevista < $1 OR r.entradaprevista > $2))
             GROUP BY a.nome ORDER BY a.nome",
        )
        .bind(periodo.map(|p| p.entrada))
        .bind(periodo.map(|p| p.saida))
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn ocupacao_mensal(&self, ano: i32, mes: u32) -> Result<Vec<(i64, i64)>, DomainError> {
        sqlx::query_as::<_, (i64, i64)>(
            "SELECT r.idacomodacao, COUNT(*)
             FROM reserva r
             WHERE r.status != 'c'
               AND EXTRACT(YEAR FROM r.entradaprevista) = $1
               AND EXTRACT(MONTH FROM r.entradaprevista) = $2
             GROUP BY r.idacomodacao",
        )
        .bind(ano)
        .bind(mes as i32)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn comprovantes(&self) -> Result<Vec<ComprovanteResumo>, DomainError> {
        sqlx::query_as::<_, ComprovanteResumo>(
            "SELECT c.comprovante,
                    r.id AS idreserva,
                    cl.nome AS cliente,
                    a.nome AS acomodacao
             FROM consumo c
             JOIN reserva r ON r.id = c.idreserva
             JOIN cliente cl ON cl.id = r.idcliente
             JOIN acomodacao a ON a.id = r.idacomodacao
             WHERE r.status = 'f' AND c.comprovante IS NOT NULL
             ORDER BY c.fechado_em DESC",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn remover(&self, id: i64, log: NovoLog) -> Result<(), DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let status = sqlx::query_scalar::<_, String>(
            "SELECT status::text FROM reserva WHERE id = $1 FOR UPDATE",
        )
        .bind(id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| DomainError::nao_encontrado("Reserva não encontrada."))?;
        if status != "p" && status != "c" {
            return Err(DomainError::conflito(
                "Só é possível excluir reservas pendentes ou canceladas — use Cancelar.",
            ));
        }
        // conta de consumo e filhos (acompanhantes e fnrh caem por cascade)
        sqlx::query(
            "DELETE FROM item_consumido WHERE idconsumo IN
             (SELECT id FROM consumo WHERE idreserva = $1)",
        )
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(map_db_err)?;
        sqlx::query(
            "DELETE FROM adicional_consumo WHERE idconsumo IN
             (SELECT id FROM consumo WHERE idreserva = $1)",
        )
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(map_db_err)?;
        sqlx::query(
            "DELETE FROM reembolso WHERE idreserva = $1 OR idconsumo IN
             (SELECT id FROM consumo WHERE idreserva = $1)",
        )
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(map_db_err)?;
        sqlx::query("DELETE FROM consumo WHERE idreserva = $1")
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(map_db_err)?;
        sqlx::query("DELETE FROM reserva WHERE id = $1")
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(map_db_err)?;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Acompanhantes da reserva
// ---------------------------------------------------------------------------

const ACOMP_COLS: &str =
    "id, idreserva, nome, data_nascimento, parentesco, doc_tipo, doc_numero, criado_em";

#[async_trait]
impl AcompanhanteRepository for PgReservaRepository {
    async fn listar(&self, idreserva: i64) -> Result<Vec<Acompanhante>, DomainError> {
        sqlx::query_as::<_, Acompanhante>(&format!(
            "SELECT {ACOMP_COLS} FROM reserva_acompanhante
             WHERE idreserva = $1 ORDER BY nome"
        ))
        .bind(idreserva)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn criar(
        &self,
        idreserva: i64,
        novo: &NovoAcompanhante,
        log: NovoLog,
    ) -> Result<Acompanhante, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let a = sqlx::query_as::<_, Acompanhante>(&format!(
            "INSERT INTO reserva_acompanhante
                (idreserva, nome, data_nascimento, parentesco, doc_tipo, doc_numero)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING {ACOMP_COLS}"
        ))
        .bind(idreserva)
        .bind(&novo.nome)
        .bind(novo.data_nascimento)
        .bind(&novo.parentesco)
        .bind(&novo.doc_tipo)
        .bind(&novo.doc_numero)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;

        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(a)
    }

    async fn remover(&self, id: i64, log: NovoLog) -> Result<(), DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let r = sqlx::query("DELETE FROM reserva_acompanhante WHERE id = $1")
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(map_db_err)?;
        if r.rows_affected() == 0 {
            return Err(DomainError::nao_encontrado("Acompanhante não encontrado."));
        }

        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// FNRH — arquivo digital das fichas emitidas
// ---------------------------------------------------------------------------

const FNRH_COLS: &str =
    "id, idreserva, idcliente, motivo_viagem, placa_veiculo, dados, emitida_por, emitida_em";

#[async_trait]
impl FnrhRepository for PgReservaRepository {
    async fn emitir(&self, nova: &NovaFnrh, log: NovoLog) -> Result<Fnrh, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let f = sqlx::query_as::<_, Fnrh>(&format!(
            "INSERT INTO fnrh (idreserva, idcliente, motivo_viagem, placa_veiculo, dados, emitida_por)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING {FNRH_COLS}"
        ))
        .bind(nova.idreserva)
        .bind(nova.idcliente)
        .bind(&nova.motivo_viagem)
        .bind(&nova.placa_veiculo)
        .bind(&nova.dados)
        .bind(nova.emitida_por)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;

        let mut log = log;
        log.idtabela = f.id;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(f)
    }

    async fn listar_por_reserva(&self, idreserva: i64) -> Result<Vec<Fnrh>, DomainError> {
        sqlx::query_as::<_, Fnrh>(&format!(
            "SELECT {FNRH_COLS} FROM fnrh WHERE idreserva = $1 ORDER BY emitida_em DESC"
        ))
        .bind(idreserva)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn listar_por_cliente(&self, idcliente: i64) -> Result<Vec<Fnrh>, DomainError> {
        sqlx::query_as::<_, Fnrh>(&format!(
            "SELECT {FNRH_COLS} FROM fnrh WHERE idcliente = $1 ORDER BY emitida_em DESC"
        ))
        .bind(idcliente)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn listar_periodo(
        &self,
        inicio: chrono::NaiveDate,
        fim: chrono::NaiveDate,
    ) -> Result<Vec<Fnrh>, DomainError> {
        sqlx::query_as::<_, Fnrh>(&format!(
            "SELECT {FNRH_COLS} FROM fnrh
             WHERE emitida_em::date BETWEEN $1 AND $2
             ORDER BY emitida_em"
        ))
        .bind(inicio)
        .bind(fim)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }
}
