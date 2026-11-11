//! Repositório de contratos corporativos — CRUD + resolução por código
//! público (motor de reservas).

use async_trait::async_trait;
use clarituz_domain::entities::{ContratoCorporativo, NovoLog};
use clarituz_domain::error::DomainError;
use clarituz_domain::ports::{ContratoRepository, NovoContrato};
use sqlx::PgPool;

use super::audit;
use crate::persistence::db::map_db_err;

const COLS: &str = "id, empresa, codigo, desconto_pct, vigente_de, vigente_ate,
    contato, email, ativo, notas, criado_em, atualizado_em";

pub struct PgContratoRepository {
    pool: PgPool,
}

impl PgContratoRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl ContratoRepository for PgContratoRepository {
    async fn listar(&self) -> Result<Vec<ContratoCorporativo>, DomainError> {
        sqlx::query_as::<_, ContratoCorporativo>(&format!(
            "SELECT {COLS} FROM contrato_corporativo ORDER BY empresa"
        ))
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn buscar(&self, id: i64) -> Result<Option<ContratoCorporativo>, DomainError> {
        sqlx::query_as::<_, ContratoCorporativo>(&format!(
            "SELECT {COLS} FROM contrato_corporativo WHERE id = $1"
        ))
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn por_codigo(&self, codigo: &str) -> Result<Option<ContratoCorporativo>, DomainError> {
        sqlx::query_as::<_, ContratoCorporativo>(&format!(
            "SELECT {COLS} FROM contrato_corporativo WHERE upper(codigo) = upper($1)"
        ))
        .bind(codigo)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn criar(
        &self,
        novo: &NovoContrato,
        log: NovoLog,
    ) -> Result<ContratoCorporativo, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let c = sqlx::query_as::<_, ContratoCorporativo>(&format!(
            "INSERT INTO contrato_corporativo
                (empresa, codigo, desconto_pct, vigente_de, vigente_ate, contato, email, notas)
             VALUES ($1, upper($2), $3, $4, $5, $6, $7, $8)
             RETURNING {COLS}"
        ))
        .bind(novo.empresa.trim())
        .bind(novo.codigo.trim())
        .bind(novo.desconto_pct)
        .bind(novo.vigente_de)
        .bind(novo.vigente_ate)
        .bind(&novo.contato)
        .bind(&novo.email)
        .bind(&novo.notas)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;
        let mut log = log;
        log.idtabela = c.id;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(c)
    }

    async fn atualizar(
        &self,
        id: i64,
        dados: &NovoContrato,
        log: NovoLog,
    ) -> Result<Option<ContratoCorporativo>, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let c = sqlx::query_as::<_, ContratoCorporativo>(&format!(
            "UPDATE contrato_corporativo SET empresa = $2, codigo = upper($3),
                    desconto_pct = $4, vigente_de = $5, vigente_ate = $6,
                    contato = $7, email = $8, notas = $9, atualizado_em = now()
             WHERE id = $1
             RETURNING {COLS}"
        ))
        .bind(id)
        .bind(dados.empresa.trim())
        .bind(dados.codigo.trim())
        .bind(dados.desconto_pct)
        .bind(dados.vigente_de)
        .bind(dados.vigente_ate)
        .bind(&dados.contato)
        .bind(&dados.email)
        .bind(&dados.notas)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?;
        if c.is_some() {
            let mut log = log;
            log.idtabela = id;
            audit::gravar(&mut *tx, &log).await?;
        }
        tx.commit().await.map_err(map_db_err)?;
        Ok(c)
    }

    async fn definir_ativo(
        &self,
        id: i64,
        ativo: bool,
        log: NovoLog,
    ) -> Result<Option<ContratoCorporativo>, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let c = sqlx::query_as::<_, ContratoCorporativo>(&format!(
            "UPDATE contrato_corporativo SET ativo = $2, atualizado_em = now()
             WHERE id = $1 RETURNING {COLS}"
        ))
        .bind(id)
        .bind(ativo)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?;
        if c.is_some() {
            let mut log = log;
            log.idtabela = id;
            audit::gravar(&mut *tx, &log).await?;
        }
        tx.commit().await.map_err(map_db_err)?;
        Ok(c)
    }
}
