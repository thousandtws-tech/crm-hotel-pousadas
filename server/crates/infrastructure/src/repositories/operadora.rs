//! Repositório de operadoras B2B — CRUD + credencial de extranet +
//! faturamento segregado (reservas por `idoperadora`).

use async_trait::async_trait;
use chrono::NaiveDate;
use clarituz_domain::entities::Operadora;
use clarituz_domain::error::DomainError;
use clarituz_domain::ports::{FaturamentoLinha, NovaOperadora, OperadoraRepository};
use sqlx::PgPool;

use super::audit;
use crate::db::map_db_err;

const COLS: &str = "id, nome, contato, email, telefone, comissao_pct,
    token_extranet, ativa, notas, criado_em, atualizado_em";

pub struct PgOperadoraRepository {
    pool: PgPool,
}

impl PgOperadoraRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl OperadoraRepository for PgOperadoraRepository {
    async fn listar(&self) -> Result<Vec<Operadora>, DomainError> {
        sqlx::query_as::<_, Operadora>(&format!("SELECT {COLS} FROM operadora ORDER BY nome"))
            .fetch_all(&self.pool)
            .await
            .map_err(map_db_err)
    }

    async fn buscar(&self, id: i64) -> Result<Option<Operadora>, DomainError> {
        sqlx::query_as::<_, Operadora>(&format!("SELECT {COLS} FROM operadora WHERE id = $1"))
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map_err(map_db_err)
    }

    async fn por_token(&self, token: &str) -> Result<Option<Operadora>, DomainError> {
        sqlx::query_as::<_, Operadora>(&format!(
            "SELECT {COLS} FROM operadora WHERE token_extranet = $1 AND ativa"
        ))
        .bind(token)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn criar(
        &self,
        nova: &NovaOperadora,
        token: &str,
        log: clarituz_domain::entities::NovoLog,
    ) -> Result<Operadora, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let op = sqlx::query_as::<_, Operadora>(&format!(
            "INSERT INTO operadora (nome, contato, email, telefone, comissao_pct,
                                   token_extranet, notas)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING {COLS}"
        ))
        .bind(nova.nome.trim())
        .bind(&nova.contato)
        .bind(&nova.email)
        .bind(&nova.telefone)
        .bind(nova.comissao_pct)
        .bind(token)
        .bind(&nova.notas)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;
        let mut log = log;
        log.idtabela = op.id;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(op)
    }

    async fn atualizar(
        &self,
        id: i64,
        dados: &NovaOperadora,
        log: clarituz_domain::entities::NovoLog,
    ) -> Result<Option<Operadora>, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let op = sqlx::query_as::<_, Operadora>(&format!(
            "UPDATE operadora SET nome = $2, contato = $3, email = $4, telefone = $5,
                    comissao_pct = $6, notas = $7, atualizado_em = now()
             WHERE id = $1
             RETURNING {COLS}"
        ))
        .bind(id)
        .bind(dados.nome.trim())
        .bind(&dados.contato)
        .bind(&dados.email)
        .bind(&dados.telefone)
        .bind(dados.comissao_pct)
        .bind(&dados.notas)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?;
        if op.is_some() {
            let mut log = log;
            log.idtabela = id;
            audit::gravar(&mut *tx, &log).await?;
        }
        tx.commit().await.map_err(map_db_err)?;
        Ok(op)
    }

    async fn definir_ativa(
        &self,
        id: i64,
        ativa: bool,
        log: clarituz_domain::entities::NovoLog,
    ) -> Result<Option<Operadora>, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let op = sqlx::query_as::<_, Operadora>(&format!(
            "UPDATE operadora SET ativa = $2, atualizado_em = now()
             WHERE id = $1 RETURNING {COLS}"
        ))
        .bind(id)
        .bind(ativa)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?;
        if op.is_some() {
            let mut log = log;
            log.idtabela = id;
            audit::gravar(&mut *tx, &log).await?;
        }
        tx.commit().await.map_err(map_db_err)?;
        Ok(op)
    }

    async fn rotacionar_token(
        &self,
        id: i64,
        token: &str,
        log: clarituz_domain::entities::NovoLog,
    ) -> Result<Option<Operadora>, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let op = sqlx::query_as::<_, Operadora>(&format!(
            "UPDATE operadora SET token_extranet = $2, atualizado_em = now()
             WHERE id = $1 RETURNING {COLS}"
        ))
        .bind(id)
        .bind(token)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?;
        if op.is_some() {
            let mut log = log;
            log.idtabela = id;
            audit::gravar(&mut *tx, &log).await?;
        }
        tx.commit().await.map_err(map_db_err)?;
        Ok(op)
    }

    async fn faturamento(
        &self,
        id: i64,
        de: NaiveDate,
        ate: NaiveDate,
    ) -> Result<Vec<FaturamentoLinha>, DomainError> {
        sqlx::query_as::<_, FaturamentoLinha>(
            "SELECT r.id AS idreserva, c.nome AS hospede,
                    r.entradaprevista AS entrada, r.saidaprevista AS saida,
                    r.status::text AS status,
                    COALESCE(
                        co.valor_estadia + co.valor_itens + co.valor_adicional
                        - co.total_desconto,
                        0
                    ) AS valor_total
             FROM reserva r
             JOIN cliente c ON c.id = r.idcliente
             LEFT JOIN consumo co ON co.idreserva = r.id
             WHERE r.idoperadora = $1
               AND r.entradaprevista < $3 AND r.saidaprevista > $2
             ORDER BY r.entradaprevista",
        )
        .bind(id)
        .bind(de)
        .bind(ate)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }
}
