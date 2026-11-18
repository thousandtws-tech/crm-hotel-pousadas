//! Persistência da distribuição — mapeamentos, revisões recebidas,
//! outbox ARI, vínculos de reserva externa e pendências operacionais.
//!
//! Regras-chave:
//! - `revisao_inserir` deduplica por (idintegracao, revision_id) —
//!   webhook + feed entregando a mesma revisão aplicam uma vez.
//! - `outbox_drenar` coalesce por acomodação: devolve janelas já
//!   consumidas (DELETE … RETURNING) para o worker recalcular o estado
//!   atual — um job antigo nunca sobrescreve um estado mais novo.
//! - `reserva_vincular` é idempotente por (booking, reserva) — falha
//!   depois do commit local mas antes do ACK não duplica vínculo.

use async_trait::async_trait;
use clarituz_domain::entities::{
    EnvioDistribuicao, MapaDistribuicao, MapaDistribuicaoView, NovoOutboxAri,
    PendenciaDistribuicao, ReservaDistribuicao, ResumoDistribuicao, RevisaoDistribuicao,
};
use clarituz_domain::error::DomainError;
use clarituz_domain::ports::{DistribuicaoRepository, RevisaoRemota};
use sqlx::PgPool;

use crate::persistence::db::map_db_err;

pub struct PgDistribuicaoRepository {
    pool: PgPool,
}

impl PgDistribuicaoRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl DistribuicaoRepository for PgDistribuicaoRepository {
    // -- mapeamento ------------------------------------------------------

    async fn mapa_listar(
        &self,
        idintegracao: i64,
    ) -> Result<Vec<MapaDistribuicaoView>, DomainError> {
        sqlx::query_as::<_, MapaDistribuicaoView>(
            "SELECT m.id, m.idacomodacao, a.nome AS acomodacao, a.numero,
                    m.room_type_id, m.rate_plan_id, m.ativo, m.atualizado_em
             FROM distribuicao_mapa m
             JOIN acomodacao a ON a.id = m.idacomodacao
             WHERE m.idintegracao = $1
             ORDER BY a.nome, a.numero",
        )
        .bind(idintegracao)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn mapa_ativos(&self, idintegracao: i64) -> Result<Vec<MapaDistribuicao>, DomainError> {
        sqlx::query_as::<_, MapaDistribuicao>(
            "SELECT * FROM distribuicao_mapa
             WHERE idintegracao = $1 AND ativo ORDER BY idacomodacao",
        )
        .bind(idintegracao)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn mapa_por_acomodacao(
        &self,
        idintegracao: i64,
        idacomodacao: i64,
    ) -> Result<Option<MapaDistribuicao>, DomainError> {
        sqlx::query_as::<_, MapaDistribuicao>(
            "SELECT * FROM distribuicao_mapa
             WHERE idintegracao = $1 AND idacomodacao = $2",
        )
        .bind(idintegracao)
        .bind(idacomodacao)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn mapa_por_room_type(
        &self,
        idintegracao: i64,
        room_type_id: &str,
    ) -> Result<Option<MapaDistribuicao>, DomainError> {
        sqlx::query_as::<_, MapaDistribuicao>(
            "SELECT * FROM distribuicao_mapa
             WHERE idintegracao = $1 AND room_type_id = $2 AND ativo
             ORDER BY atualizado_em DESC LIMIT 1",
        )
        .bind(idintegracao)
        .bind(room_type_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn mapa_salvar(
        &self,
        idintegracao: i64,
        idacomodacao: i64,
        room_type_id: &str,
        rate_plan_id: &str,
    ) -> Result<MapaDistribuicao, DomainError> {
        sqlx::query_as::<_, MapaDistribuicao>(
            "INSERT INTO distribuicao_mapa
                (idintegracao, idacomodacao, room_type_id, rate_plan_id)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (idintegracao, idacomodacao) DO UPDATE SET
                room_type_id = EXCLUDED.room_type_id,
                rate_plan_id = EXCLUDED.rate_plan_id,
                ativo = true,
                versao = distribuicao_mapa.versao + 1,
                atualizado_em = now()
             RETURNING *",
        )
        .bind(idintegracao)
        .bind(idacomodacao)
        .bind(room_type_id)
        .bind(rate_plan_id)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn mapa_desativar(&self, id: i64) -> Result<(), DomainError> {
        sqlx::query(
            "UPDATE distribuicao_mapa SET ativo = false, atualizado_em = now()
             WHERE id = $1",
        )
        .bind(id)
        .execute(&self.pool)
        .await
        .map_err(map_db_err)?;
        Ok(())
    }

    // -- outbox ARI --------------------------------------------------------

    async fn outbox_enfileirar(&self, itens: &[NovoOutboxAri]) -> Result<(), DomainError> {
        for i in itens {
            sqlx::query(
                "INSERT INTO distribuicao_outbox
                    (idintegracao, idacomodacao, inicio, fim, motivo)
                 VALUES ($1, $2, $3, $4, $5)",
            )
            .bind(i.idintegracao)
            .bind(i.idacomodacao)
            .bind(i.inicio)
            .bind(i.fim)
            .bind(&i.motivo)
            .execute(&self.pool)
            .await
            .map_err(map_db_err)?;
        }
        Ok(())
    }

    async fn outbox_drenar(&self, limite: i64) -> Result<Vec<NovoOutboxAri>, DomainError> {
        // DELETE … RETURNING coalesce: consome todas as linhas da mesma
        // acomodação e devolve a janela-união — o estado enviado é sempre
        // recalculado, então um job velho não pode sobrescrever o novo.
        sqlx::query_as::<_, (i64, i64, chrono::NaiveDate, chrono::NaiveDate, String)>(
            "WITH alvo AS (
                 SELECT DISTINCT ON (idintegracao, idacomodacao)
                        id, idintegracao, idacomodacao
                 FROM distribuicao_outbox
                 ORDER BY idintegracao, idacomodacao, id
                 LIMIT $1
             ),
             consumidas AS (
                 DELETE FROM distribuicao_outbox o
                 WHERE (o.idintegracao, o.idacomodacao) IN
                       (SELECT idintegracao, idacomodacao FROM alvo)
                 RETURNING o.idintegracao, o.idacomodacao, o.inicio, o.fim, o.motivo
             )
             SELECT idintegracao, idacomodacao,
                    min(inicio) AS inicio, max(fim) AS fim,
                    string_agg(DISTINCT motivo, ', ') AS motivo
             FROM consumidas
             GROUP BY idintegracao, idacomodacao",
        )
        .bind(limite)
        .fetch_all(&self.pool)
        .await
        .map(|rows| {
            rows.into_iter()
                .map(
                    |(idintegracao, idacomodacao, inicio, fim, motivo)| NovoOutboxAri {
                        idintegracao,
                        idacomodacao,
                        inicio,
                        fim,
                        motivo,
                    },
                )
                .collect()
        })
        .map_err(map_db_err)
    }

    // -- envios ------------------------------------------------------------

    async fn envio_registrar(
        &self,
        idintegracao: i64,
        tipo: &str,
        valores: &serde_json::Value,
        task_ids: &serde_json::Value,
        warnings: &serde_json::Value,
    ) -> Result<(), DomainError> {
        sqlx::query(
            "INSERT INTO distribuicao_envio (idintegracao, tipo, valores, task_ids, warnings)
             VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(idintegracao)
        .bind(tipo)
        .bind(valores)
        .bind(task_ids)
        .bind(warnings)
        .execute(&self.pool)
        .await
        .map_err(map_db_err)?;
        Ok(())
    }

    async fn envio_listar(
        &self,
        idintegracao: i64,
        limite: i64,
    ) -> Result<Vec<EnvioDistribuicao>, DomainError> {
        sqlx::query_as::<_, EnvioDistribuicao>(
            "SELECT * FROM distribuicao_envio
             WHERE idintegracao = $1 ORDER BY id DESC LIMIT $2",
        )
        .bind(idintegracao)
        .bind(limite)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    // -- revisões ------------------------------------------------------------

    async fn revisao_inserir(
        &self,
        idintegracao: i64,
        rev: &RevisaoRemota,
    ) -> Result<bool, DomainError> {
        let n = sqlx::query(
            "INSERT INTO distribuicao_revisao
                (idintegracao, revision_id, booking_id, unique_id, ota_name,
                 ota_reservation_code, status, property_id, payload, inserted_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (idintegracao, revision_id) DO NOTHING",
        )
        .bind(idintegracao)
        .bind(&rev.id)
        .bind(&rev.booking_id)
        .bind(&rev.unique_id)
        .bind(&rev.ota_name)
        .bind(&rev.ota_reservation_code)
        .bind(&rev.status)
        .bind(&rev.property_id)
        .bind(&rev.raw)
        .bind(rev.inserted_at)
        .execute(&self.pool)
        .await
        .map_err(map_db_err)?;
        Ok(n.rows_affected() > 0)
    }

    async fn revisao_por_id_remoto(
        &self,
        idintegracao: i64,
        revision_id: &str,
    ) -> Result<Option<RevisaoDistribuicao>, DomainError> {
        sqlx::query_as::<_, RevisaoDistribuicao>(
            "SELECT * FROM distribuicao_revisao
             WHERE idintegracao = $1 AND revision_id = $2",
        )
        .bind(idintegracao)
        .bind(revision_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn revisao_listar(
        &self,
        idintegracao: i64,
        limite: i64,
    ) -> Result<Vec<RevisaoDistribuicao>, DomainError> {
        sqlx::query_as::<_, RevisaoDistribuicao>(
            "SELECT * FROM distribuicao_revisao
             WHERE idintegracao = $1 ORDER BY id DESC LIMIT $2",
        )
        .bind(idintegracao)
        .bind(limite)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn revisao_marcar(
        &self,
        id: i64,
        aplicada: bool,
        erro: Option<&str>,
    ) -> Result<(), DomainError> {
        sqlx::query("UPDATE distribuicao_revisao SET aplicada = $2, erro = $3 WHERE id = $1")
            .bind(id)
            .bind(aplicada)
            .bind(erro)
            .execute(&self.pool)
            .await
            .map_err(map_db_err)?;
        Ok(())
    }

    async fn revisao_marcar_ack(&self, id: i64) -> Result<(), DomainError> {
        sqlx::query("UPDATE distribuicao_revisao SET ack = true, ack_em = now() WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(map_db_err)?;
        Ok(())
    }

    async fn revisao_mais_recente_do_booking(
        &self,
        idintegracao: i64,
        booking_id: &str,
    ) -> Result<Option<RevisaoDistribuicao>, DomainError> {
        sqlx::query_as::<_, RevisaoDistribuicao>(
            "SELECT * FROM distribuicao_revisao
             WHERE idintegracao = $1 AND booking_id = $2 AND aplicada
             ORDER BY inserted_at DESC NULLS LAST, id DESC LIMIT 1",
        )
        .bind(idintegracao)
        .bind(booking_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)
    }

    // -- vínculo reserva ↔ booking -----------------------------------------

    async fn reserva_vinculo(
        &self,
        idintegracao: i64,
        booking_id: &str,
    ) -> Result<Vec<ReservaDistribuicao>, DomainError> {
        sqlx::query_as::<_, ReservaDistribuicao>(
            "SELECT * FROM distribuicao_reserva
             WHERE idintegracao = $1 AND booking_id = $2",
        )
        .bind(idintegracao)
        .bind(booking_id)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn reserva_vincular(
        &self,
        idintegracao: i64,
        idreserva: i64,
        booking_id: &str,
        ota_name: Option<&str>,
        ota_reservation_code: Option<&str>,
        dados: &serde_json::Value,
    ) -> Result<(), DomainError> {
        sqlx::query(
            "INSERT INTO distribuicao_reserva
                (idintegracao, idreserva, booking_id, ota_name,
                 ota_reservation_code, dados)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (idintegracao, booking_id, idreserva) DO NOTHING",
        )
        .bind(idintegracao)
        .bind(idreserva)
        .bind(booking_id)
        .bind(ota_name)
        .bind(ota_reservation_code)
        .bind(dados)
        .execute(&self.pool)
        .await
        .map_err(map_db_err)?;
        Ok(())
    }

    // -- pendências ----------------------------------------------------------

    async fn pendencia(
        &self,
        idintegracao: i64,
        tipo: &str,
        descricao: &str,
        revision_id: Option<&str>,
        dados: &serde_json::Value,
    ) -> Result<(), DomainError> {
        sqlx::query(
            "INSERT INTO distribuicao_pendencia
                (idintegracao, tipo, descricao, revision_id, dados)
             VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(idintegracao)
        .bind(tipo)
        .bind(descricao)
        .bind(revision_id)
        .bind(dados)
        .execute(&self.pool)
        .await
        .map_err(map_db_err)?;
        Ok(())
    }

    async fn pendencias(
        &self,
        idintegracao: i64,
        abertas: bool,
    ) -> Result<Vec<PendenciaDistribuicao>, DomainError> {
        sqlx::query_as::<_, PendenciaDistribuicao>(
            "SELECT * FROM distribuicao_pendencia
             WHERE idintegracao = $1 AND ($2 = false OR resolvida = false)
             ORDER BY id DESC LIMIT 200",
        )
        .bind(idintegracao)
        .bind(abertas)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn pendencia_resolver(&self, id: i64) -> Result<(), DomainError> {
        sqlx::query(
            "UPDATE distribuicao_pendencia SET resolvida = true, resolvido_em = now()
             WHERE id = $1",
        )
        .bind(id)
        .execute(&self.pool)
        .await
        .map_err(map_db_err)?;
        Ok(())
    }

    async fn pendencia_resolver_por_revisao(
        &self,
        idintegracao: i64,
        revision_id: &str,
    ) -> Result<u64, DomainError> {
        let r = sqlx::query(
            "UPDATE distribuicao_pendencia SET resolvida = true, resolvido_em = now()
             WHERE idintegracao = $1 AND revision_id = $2 AND resolvida = false",
        )
        .bind(idintegracao)
        .bind(revision_id)
        .execute(&self.pool)
        .await
        .map_err(map_db_err)?;
        Ok(r.rows_affected())
    }

    // -- resumo ----------------------------------------------------------------

    async fn resumo(&self, idintegracao: i64) -> Result<ResumoDistribuicao, DomainError> {
        sqlx::query_as::<
            _,
            (
                i64,
                i64,
                i64,
                i64,
                i64,
                i64,
                Option<chrono::DateTime<chrono::Utc>>,
                Option<chrono::DateTime<chrono::Utc>>,
            ),
        >(
            "SELECT
                (SELECT count(*) FROM distribuicao_mapa
                  WHERE idintegracao = $1 AND ativo),
                (SELECT count(*) FROM acomodacao a
                  WHERE a.ativo AND NOT EXISTS (
                      SELECT 1 FROM distribuicao_mapa m
                      WHERE m.idintegracao = $1 AND m.idacomodacao = a.id AND m.ativo)),
                (SELECT count(*) FROM distribuicao_revisao
                  WHERE idintegracao = $1 AND NOT aplicada),
                (SELECT count(*) FROM distribuicao_revisao
                  WHERE idintegracao = $1 AND aplicada AND NOT ack),
                (SELECT count(*) FROM distribuicao_pendencia
                  WHERE idintegracao = $1 AND NOT resolvida),
                (SELECT count(*) FROM distribuicao_outbox
                  WHERE idintegracao = $1),
                (SELECT max(recebido_em) FROM distribuicao_revisao
                  WHERE idintegracao = $1),
                (SELECT max(criado_em) FROM distribuicao_envio
                  WHERE idintegracao = $1)",
        )
        .bind(idintegracao)
        .fetch_one(&self.pool)
        .await
        .map(
            |(
                mapeadas,
                sem_mapeamento,
                revisoes_pendentes,
                revisoes_sem_ack,
                pendencias_abertas,
                outbox_pendente,
                ultima_revisao_em,
                ultimo_envio_em,
            )| {
                ResumoDistribuicao {
                    mapeadas,
                    sem_mapeamento,
                    revisoes_pendentes,
                    revisoes_sem_ack,
                    pendencias_abertas,
                    outbox_pendente,
                    ultima_revisao_em,
                    ultimo_envio_em,
                }
            },
        )
        .map_err(map_db_err)
    }

    async fn ocupacao_dias(
        &self,
        idacomodacao: i64,
        inicio: chrono::NaiveDate,
        fim: chrono::NaiveDate,
    ) -> Result<Vec<chrono::NaiveDate>, DomainError> {
        // Um item por noite ocupada: reservas ativas (periodo [e,s)) +
        // bloqueios [inicio,fim] — intersecção com a janela.
        sqlx::query_scalar::<_, chrono::NaiveDate>(
            "SELECT DISTINCT d::date
             FROM generate_series($2, $3, interval '1 day') d
             WHERE EXISTS (
                 SELECT 1 FROM reserva r
                 WHERE r.idacomodacao = $1 AND r.status IN ('p','i')
                   AND r.periodo @> d::date
             ) OR EXISTS (
                 SELECT 1 FROM bloqueio b
                 WHERE b.idacomodacao = $1
                   AND daterange(b.inicio, b.fim, '[]') @> d::date
             )
             ORDER BY d",
        )
        .bind(idacomodacao)
        .bind(inicio)
        .bind(fim)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }
}
