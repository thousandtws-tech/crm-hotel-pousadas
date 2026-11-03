//! Café da manhã — quadro de presença por reserva/dia.

use super::audit;
use crate::db::map_db_err;
use async_trait::async_trait;
use chrono::NaiveDate;
use clarituz_domain::entities::{CafePresenca, NovoLog};
use clarituz_domain::ports::{CafeRepository, NovaPresenca, ReservaDoCafe};
use clarituz_domain::queries::{CafeQuadroItem, PresencaView};
use clarituz_domain::DomainError;
use clarituz_shared::{Page, PageParams};
use sqlx::PgPool;

#[derive(Clone)]
pub struct PgCafeRepository {
    pool: PgPool,
}
impl PgCafeRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

const PRESENCA_COLS: &str =
    "id, idreserva, data, quantidade, registrado_por, criado_em, atualizado_em, version";

#[async_trait]
impl CafeRepository for PgCafeRepository {
    async fn quadro(&self, data: NaiveDate) -> Result<Vec<CafeQuadroItem>, DomainError> {
        sqlx::query_as::<_, CafeQuadroItem>(
            "SELECT r.id AS idreserva, cl.nome AS cliente_nome, r.quantidade_hospedes,
                    q.numero AS quarto_numero, a.nome AS acomodacao_nome,
                    r.entradaprevista, r.saidaprevista,
                    p.id AS presenca_id, p.quantidade AS presenca_quantidade,
                    p.criado_em AS presenca_em, f.nome AS registrado_por_nome
             FROM reserva r
             JOIN cliente cl     ON cl.id = r.idcliente
             JOIN acomodacao a   ON a.id  = r.idacomodacao
             LEFT JOIN quarto q  ON q.id  = r.idquarto
             LEFT JOIN cafe_presenca p ON p.idreserva = r.id AND p.data = $1
             LEFT JOIN funcionario f   ON f.id = p.registrado_por
             WHERE r.status != 'c'
               AND r.entradaprevista <= $1 AND r.saidaprevista >= $1
             ORDER BY q.numero NULLS LAST, a.nome, cl.nome",
        )
        .bind(data)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn reserva(&self, idreserva: i64) -> Result<Option<ReservaDoCafe>, DomainError> {
        sqlx::query_as::<_, (i64, i32, NaiveDate, NaiveDate, bool)>(
            "SELECT id, quantidade_hospedes, entradaprevista, saidaprevista,
                    status = 'c' AS cancelada
             FROM reserva WHERE id = $1",
        )
        .bind(idreserva)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)
        .map(|opt| {
            opt.map(
                |(id, quantidade_hospedes, entradaprevista, saidaprevista, cancelada)| {
                    ReservaDoCafe {
                        id,
                        quantidade_hospedes,
                        entradaprevista,
                        saidaprevista,
                        cancelada,
                    }
                },
            )
        })
    }

    async fn registrar_presenca(
        &self,
        nova: &NovaPresenca,
        idfuncionario: i64,
        log: NovoLog,
    ) -> Result<CafePresenca, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let p = sqlx::query_as::<_, CafePresenca>(&format!(
            "INSERT INTO cafe_presenca (idreserva, data, quantidade, registrado_por)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (idreserva, data) DO UPDATE SET
                     quantidade = EXCLUDED.quantidade,
                     registrado_por = EXCLUDED.registrado_por,
                     atualizado_em = now()
                 RETURNING {PRESENCA_COLS}"
        ))
        .bind(nova.idreserva)
        .bind(nova.data)
        .bind(nova.quantidade)
        .bind(idfuncionario)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(p)
    }

    async fn remover_presenca(&self, id: i64, log: NovoLog) -> Result<(), DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let n = sqlx::query("DELETE FROM cafe_presenca WHERE id = $1")
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(map_db_err)?
            .rows_affected();
        if n == 0 {
            return Err(DomainError::nao_encontrado("Presença não encontrada."));
        }
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(())
    }

    async fn historico(
        &self,
        inicio: Option<NaiveDate>,
        fim: Option<NaiveDate>,
        page: PageParams,
    ) -> Result<Page<PresencaView>, DomainError> {
        let total: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM cafe_presenca p
             WHERE ($1::date IS NULL OR p.data >= $1)
               AND ($2::date IS NULL OR p.data <= $2)",
        )
        .bind(inicio)
        .bind(fim)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)?;

        let itens = sqlx::query_as::<_, PresencaView>(
            "SELECT p.id, p.idreserva, p.data, p.quantidade,
                    cl.nome AS cliente_nome, q.numero AS quarto_numero,
                    f.nome AS registrado_por_nome, p.criado_em
             FROM cafe_presenca p
             JOIN reserva r     ON r.id  = p.idreserva
             JOIN cliente cl    ON cl.id = r.idcliente
             LEFT JOIN quarto q ON q.id  = r.idquarto
             LEFT JOIN funcionario f ON f.id = p.registrado_por
             WHERE ($1::date IS NULL OR p.data >= $1)
               AND ($2::date IS NULL OR p.data <= $2)
             ORDER BY p.data DESC, p.criado_em DESC
             LIMIT $3 OFFSET $4",
        )
        .bind(inicio)
        .bind(fim)
        .bind(page.limit())
        .bind(page.offset())
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)?;

        Ok(Page::new(itens, page, total))
    }
}
