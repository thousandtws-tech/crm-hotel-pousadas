//! `alerta_operacional` — dedup durável dos alertas do monitor de
//! falhas operacionais. A chave primária é a `dedup_key`: a inserção
//! que conflita indica "ocorrência já alertada" e não dispara de novo.

use crate::persistence::db::map_db_err;
use async_trait::async_trait;
use clarituz_domain::ports::{AlertaOperacionalRepository, NovoAlerta};
use clarituz_domain::DomainError;
use sqlx::PgPool;

pub struct PgAlertaOperacionalRepository {
    pool: PgPool,
}

impl PgAlertaOperacionalRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl AlertaOperacionalRepository for PgAlertaOperacionalRepository {
    async fn registrar(&self, alerta: &NovoAlerta) -> Result<bool, DomainError> {
        let r = sqlx::query(
            "INSERT INTO alerta_operacional (dedup_key, origem, id_origem, titulo, mensagem)
             VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (dedup_key) DO NOTHING",
        )
        .bind(&alerta.dedup_key)
        .bind(&alerta.origem)
        .bind(alerta.id_origem)
        .bind(&alerta.titulo)
        .bind(&alerta.mensagem)
        .execute(&self.pool)
        .await
        .map_err(map_db_err)?;
        Ok(r.rows_affected() > 0)
    }
}
