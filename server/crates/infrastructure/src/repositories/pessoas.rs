//! Funcionários, sessões de refresh, log de acesso e clientes.

use super::audit;
use crate::db::{map_db_err, map_del_err};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use clarituz_domain::entities::{Cliente, ClienteDocumento, Funcionario, NovoLog, SessaoRefresh};
use clarituz_domain::ports::{
    AtualizaFuncionario, ClienteRepository, DocumentoRepository, FiltroCliente,
    FuncionarioRepository, LogAcessoRepository, NovoCliente, NovoClienteSite, NovoDocumento,
    NovoFuncionario, SessaoRepository,
};
use clarituz_domain::DomainError;
use clarituz_shared::{Page, PageParams};
use sqlx::PgPool;
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Funcionários
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct PgFuncionarioRepository {
    pool: PgPool,
}

impl PgFuncionarioRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

const FUNCIONARIO_COLS: &str =
    "id, nome, login, senha_hash, cpf, data_nascimento, nivel, financeiro, ativo, version, criado_em, atualizado_em";

#[async_trait]
impl FuncionarioRepository for PgFuncionarioRepository {
    async fn buscar_por_login(&self, login: &str) -> Result<Option<Funcionario>, DomainError> {
        sqlx::query_as::<_, Funcionario>(&format!(
            "SELECT {FUNCIONARIO_COLS} FROM funcionario WHERE login = $1"
        ))
        .bind(login)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn buscar(&self, id: i64) -> Result<Option<Funcionario>, DomainError> {
        sqlx::query_as::<_, Funcionario>(&format!(
            "SELECT {FUNCIONARIO_COLS} FROM funcionario WHERE id = $1"
        ))
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn listar(
        &self,
        page: PageParams,
        apenas_ativos: bool,
    ) -> Result<Page<Funcionario>, DomainError> {
        let filtro = if apenas_ativos { "WHERE ativo" } else { "" };
        let total: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM funcionario {filtro}"))
            .fetch_one(&self.pool)
            .await
            .map_err(map_db_err)?;

        let items = sqlx::query_as::<_, Funcionario>(&format!(
            "SELECT {FUNCIONARIO_COLS} FROM funcionario {filtro}
             ORDER BY nome LIMIT $1 OFFSET $2"
        ))
        .bind(page.limit())
        .bind(page.offset())
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)?;

        Ok(Page::new(items, page, total))
    }

    async fn login_em_uso(&self, login: &str, exceto_id: i64) -> Result<bool, DomainError> {
        sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM funcionario WHERE login = $1 AND id != $2)",
        )
        .bind(login)
        .bind(exceto_id)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn criar(
        &self,
        novo: &NovoFuncionario,
        log: NovoLog,
    ) -> Result<Funcionario, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;

        let f = sqlx::query_as::<_, Funcionario>(&format!(
            "INSERT INTO funcionario (nome, login, senha_hash, cpf, data_nascimento, nivel, ativo)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING {FUNCIONARIO_COLS}"
        ))
        .bind(&novo.nome)
        .bind(&novo.login)
        .bind(&novo.senha_hash)
        .bind(&novo.cpf)
        .bind(novo.data_nascimento)
        .bind(novo.nivel)
        .bind(novo.ativo)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;

        let mut log = log;
        log.idtabela = f.id;
        audit::gravar(&mut *tx, &log).await?;

        tx.commit().await.map_err(map_db_err)?;
        Ok(f)
    }

    async fn atualizar(
        &self,
        id: i64,
        d: &AtualizaFuncionario,
        log: NovoLog,
    ) -> Result<Funcionario, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;

        let f = sqlx::query_as::<_, Funcionario>(&format!(
            "UPDATE funcionario SET
                nome = COALESCE($2, nome),
                login = COALESCE($3, login),
                cpf = COALESCE($4, cpf),
                data_nascimento = COALESCE($5, data_nascimento),
                nivel = COALESCE($6, nivel),
                senha_hash = COALESCE($7, senha_hash),
                atualizado_em = now()
             WHERE id = $1 AND ($8::bigint IS NULL OR version = $8)
             RETURNING {FUNCIONARIO_COLS}"
        ))
        .bind(id)
        .bind(&d.nome)
        .bind(&d.login)
        .bind(&d.cpf)
        .bind(d.data_nascimento)
        .bind(d.nivel)
        .bind(&d.senha_hash)
        .bind(d.version)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| {
            DomainError::conflito(
                "Funcionário alterado por outro usuário. Recarregue e tente novamente.",
            )
        })?;

        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(f)
    }

    async fn definir_ativo(
        &self,
        id: i64,
        ativo: bool,
        log: NovoLog,
    ) -> Result<Funcionario, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let f = sqlx::query_as::<_, Funcionario>(&format!(
            "UPDATE funcionario SET ativo = $2, atualizado_em = now()
             WHERE id = $1 RETURNING {FUNCIONARIO_COLS}"
        ))
        .bind(id)
        .bind(ativo)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| DomainError::nao_encontrado("Funcionário não encontrado."))?;

        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(f)
    }

    async fn remover(&self, id: i64, log: NovoLog) -> Result<(), DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        // logacesso não tem cascade — remove junto; sessões e leituras caem sozinhas
        sqlx::query("DELETE FROM logacesso WHERE idfuncionario = $1")
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(map_db_err)?;
        let r = sqlx::query("DELETE FROM funcionario WHERE id = $1")
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(|e| {
                map_del_err(
                    e,
                    "Funcionário possui histórico no sistema — inative-o em vez de excluir.",
                )
            })?;
        if r.rows_affected() == 0 {
            return Err(DomainError::nao_encontrado("Funcionário não encontrado."));
        }
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Log de acesso
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct PgLogAcessoRepository {
    pool: PgPool,
}

impl PgLogAcessoRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl LogAcessoRepository for PgLogAcessoRepository {
    async fn registrar(
        &self,
        idfuncionario: i64,
        ip: Option<&str>,
        user_agent: Option<&str>,
    ) -> Result<(), DomainError> {
        sqlx::query("INSERT INTO logacesso (idfuncionario, ip, user_agent) VALUES ($1, $2, $3)")
            .bind(idfuncionario)
            .bind(ip)
            .bind(user_agent)
            .execute(&self.pool)
            .await
            .map_err(map_db_err)?;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Sessões de refresh token
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct PgSessaoRepository {
    pool: PgPool,
}

impl PgSessaoRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl SessaoRepository for PgSessaoRepository {
    async fn criar(
        &self,
        idfuncionario: i64,
        token_hash: &str,
        expira_em: DateTime<Utc>,
        ip: Option<&str>,
        user_agent: Option<&str>,
    ) -> Result<Uuid, DomainError> {
        sqlx::query_scalar::<_, Uuid>(
            "INSERT INTO sessao_refresh (idfuncionario, token_hash, expira_em, ip, user_agent)
             VALUES ($1, $2, $3, $4, $5) RETURNING id",
        )
        .bind(idfuncionario)
        .bind(token_hash)
        .bind(expira_em)
        .bind(ip)
        .bind(user_agent)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn buscar_valida(&self, token_hash: &str) -> Result<Option<SessaoRefresh>, DomainError> {
        sqlx::query_as::<_, SessaoRefresh>(
            "SELECT id, idfuncionario, token_hash, expira_em, revogado_em, ip, user_agent, criado_em
             FROM sessao_refresh
             WHERE token_hash = $1 AND revogado_em IS NULL AND expira_em > now()",
        )
        .bind(token_hash)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn revogar(&self, sessao_id: Uuid) -> Result<(), DomainError> {
        sqlx::query("UPDATE sessao_refresh SET revogado_em = now() WHERE id = $1")
            .bind(sessao_id)
            .execute(&self.pool)
            .await
            .map_err(map_db_err)?;
        Ok(())
    }

    async fn revogar_por_hash(&self, token_hash: &str) -> Result<(), DomainError> {
        sqlx::query("UPDATE sessao_refresh SET revogado_em = now() WHERE token_hash = $1")
            .bind(token_hash)
            .execute(&self.pool)
            .await
            .map_err(map_db_err)?;
        Ok(())
    }

    async fn revogar_todas_do_funcionario(&self, idfuncionario: i64) -> Result<u64, DomainError> {
        let r = sqlx::query(
            "UPDATE sessao_refresh SET revogado_em = now()
             WHERE idfuncionario = $1 AND revogado_em IS NULL",
        )
        .bind(idfuncionario)
        .execute(&self.pool)
        .await
        .map_err(map_db_err)?;
        Ok(r.rows_affected())
    }
}

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct PgClienteRepository {
    pool: PgPool,
}

impl PgClienteRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

const CLIENTE_COLS: &str = "id, nome, cpf, data_nascimento, email, telefone, estado, cidade, \
     nacionalidade, naturalidade, profissao, logradouro, numero, complemento, \
     bairro, cep, pais, ativo, (foto IS NOT NULL) AS tem_foto, \
     version, criado_em, atualizado_em";

#[async_trait]
impl ClienteRepository for PgClienteRepository {
    async fn buscar(&self, id: i64) -> Result<Option<Cliente>, DomainError> {
        sqlx::query_as::<_, Cliente>(&format!("SELECT {CLIENTE_COLS} FROM cliente WHERE id = $1"))
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map_err(map_db_err)
    }

    async fn listar(
        &self,
        filtro: &FiltroCliente,
        page: PageParams,
    ) -> Result<Page<Cliente>, DomainError> {
        const WHERE: &str = "
            WHERE ($1::text IS NULL
                   OR nome ILIKE '%' || $1 || '%'
                   OR cpf LIKE '%' || $1 || '%'
                   OR email ILIKE '%' || $1 || '%')
              AND ($2::bool = false OR ativo)";

        let total = sqlx::query_scalar::<_, i64>(&format!("SELECT COUNT(*) FROM cliente {WHERE}"))
            .bind(&filtro.busca)
            .bind(filtro.apenas_ativos)
            .fetch_one(&self.pool)
            .await
            .map_err(map_db_err)?;

        let items = sqlx::query_as::<_, Cliente>(&format!(
            "SELECT {CLIENTE_COLS} FROM cliente {WHERE}
             ORDER BY nome LIMIT $3 OFFSET $4"
        ))
        .bind(&filtro.busca)
        .bind(filtro.apenas_ativos)
        .bind(page.limit())
        .bind(page.offset())
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)?;

        Ok(Page::new(items, page, total))
    }

    async fn cpf_em_uso(&self, cpf: &str, exceto_id: i64) -> Result<bool, DomainError> {
        sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM cliente WHERE cpf = $1 AND id != $2)",
        )
        .bind(cpf)
        .bind(exceto_id)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn email_em_uso(&self, email: &str, exceto_id: i64) -> Result<bool, DomainError> {
        sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM cliente WHERE email = $1 AND id != $2)",
        )
        .bind(email)
        .bind(exceto_id)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn criar(&self, novo: &NovoCliente, log: NovoLog) -> Result<Cliente, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let c = sqlx::query_as::<_, Cliente>(&format!(
            "INSERT INTO cliente (nome, cpf, data_nascimento, email, telefone, estado, cidade,
                                 nacionalidade, naturalidade, profissao, logradouro, numero,
                                 complemento, bairro, cep, pais)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
             RETURNING {CLIENTE_COLS}"
        ))
        .bind(&novo.nome)
        .bind(&novo.cpf)
        .bind(novo.data_nascimento)
        .bind(&novo.email)
        .bind(&novo.telefone)
        .bind(&novo.estado)
        .bind(&novo.cidade)
        .bind(&novo.nacionalidade)
        .bind(&novo.naturalidade)
        .bind(&novo.profissao)
        .bind(&novo.logradouro)
        .bind(&novo.numero)
        .bind(&novo.complemento)
        .bind(&novo.bairro)
        .bind(&novo.cep)
        .bind(&novo.pais)
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
        d: &NovoCliente,
        log: NovoLog,
    ) -> Result<Cliente, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let c = sqlx::query_as::<_, Cliente>(&format!(
            "UPDATE cliente SET
                nome = $2, cpf = $3, data_nascimento = $4, email = $5,
                telefone = $6, estado = $7, cidade = $8,
                nacionalidade = $9, naturalidade = $10, profissao = $11,
                logradouro = $12, numero = $13, complemento = $14,
                bairro = $15, cep = $16, pais = $17, atualizado_em = now()
             WHERE id = $1 AND ($18::bigint IS NULL OR version = $18)
             RETURNING {CLIENTE_COLS}"
        ))
        .bind(id)
        .bind(&d.nome)
        .bind(&d.cpf)
        .bind(d.data_nascimento)
        .bind(&d.email)
        .bind(&d.telefone)
        .bind(&d.estado)
        .bind(&d.cidade)
        .bind(&d.nacionalidade)
        .bind(&d.naturalidade)
        .bind(&d.profissao)
        .bind(&d.logradouro)
        .bind(&d.numero)
        .bind(&d.complemento)
        .bind(&d.bairro)
        .bind(&d.cep)
        .bind(&d.pais)
        .bind(d.version)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| {
            DomainError::conflito(
                "Cliente alterado por outro usuário. Recarregue e tente novamente.",
            )
        })?;

        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(c)
    }

    async fn definir_ativo(
        &self,
        id: i64,
        ativo: bool,
        log: NovoLog,
    ) -> Result<Cliente, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let c = sqlx::query_as::<_, Cliente>(&format!(
            "UPDATE cliente SET ativo = $2, atualizado_em = now()
             WHERE id = $1 RETURNING {CLIENTE_COLS}"
        ))
        .bind(id)
        .bind(ativo)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| DomainError::nao_encontrado("Cliente não encontrado."))?;

        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(c)
    }

    async fn definir_foto(
        &self,
        id: i64,
        caminho: Option<&str>,
        log: NovoLog,
    ) -> Result<(), DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let r = sqlx::query("UPDATE cliente SET foto = $2, atualizado_em = now() WHERE id = $1")
            .bind(id)
            .bind(caminho)
            .execute(&mut *tx)
            .await
            .map_err(map_db_err)?;
        if r.rows_affected() == 0 {
            return Err(DomainError::nao_encontrado("Cliente não encontrado."));
        }

        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(())
    }

    async fn foto_caminho(&self, id: i64) -> Result<Option<String>, DomainError> {
        sqlx::query_scalar::<_, Option<String>>("SELECT foto FROM cliente WHERE id = $1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map(Option::flatten)
            .map_err(map_db_err)
    }

    async fn total_reservas(&self, id: i64) -> Result<i64, DomainError> {
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM reserva WHERE idcliente = $1")
            .bind(id)
            .fetch_one(&self.pool)
            .await
            .map_err(map_db_err)
    }

    async fn site_upsert(&self, dados: &NovoClienteSite) -> Result<i64, DomainError> {
        let existente = sqlx::query_scalar::<_, i64>(
            "SELECT id FROM cliente
             WHERE LOWER(email) = $1 OR ($2::text IS NOT NULL AND cpf = $2)
             LIMIT 1",
        )
        .bind(&dados.email)
        .bind(&dados.cpf_busca)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)?;

        if let Some(id) = existente {
            sqlx::query(
                "UPDATE cliente SET nome = $2, telefone = $3, atualizado_em = now() WHERE id = $1",
            )
            .bind(id)
            .bind(&dados.nome)
            .bind(&dados.telefone)
            .execute(&self.pool)
            .await
            .map_err(map_db_err)?;
            return Ok(id);
        }

        // Cadastro mínimo do site — `data_nascimento` é NOT NULL no schema e
        // recebe placeholder até o check-in completar a ficha (FNRH).
        sqlx::query_scalar::<_, i64>(
            "INSERT INTO cliente (nome, cpf, data_nascimento, email, telefone, ativo)
             VALUES ($1, $2, DATE '1990-01-01', $3, $4, TRUE)
             RETURNING id",
        )
        .bind(&dados.nome)
        .bind(&dados.cpf)
        .bind(&dados.email)
        .bind(&dados.telefone)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn remover(&self, id: i64, log: NovoLog) -> Result<Vec<String>, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        // chaves no object store (scans dos documentos + foto) — apagadas pela API
        let mut chaves: Vec<String> = sqlx::query_scalar(
            "SELECT scan FROM cliente_documento WHERE idcliente = $1 AND scan IS NOT NULL",
        )
        .bind(id)
        .fetch_all(&mut *tx)
        .await
        .map_err(map_db_err)?;
        if let Some(foto) =
            sqlx::query_scalar::<_, Option<String>>("SELECT foto FROM cliente WHERE id = $1")
                .bind(id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(map_db_err)?
                .flatten()
        {
            chaves.push(foto);
        }
        // cliente_documento cai por ON DELETE CASCADE
        let r = sqlx::query("DELETE FROM cliente WHERE id = $1")
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(|e| {
                map_del_err(
                    e,
                    "Cliente possui reservas ou fichas FNRH — inative-o em vez de excluir.",
                )
            })?;
        if r.rows_affected() == 0 {
            return Err(DomainError::nao_encontrado("Cliente não encontrado."));
        }
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(chaves)
    }
}

// ---------------------------------------------------------------------------
// Documentos de identidade do cliente
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct PgDocumentoRepository {
    pool: PgPool,
}

impl PgDocumentoRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

const DOC_COLS: &str =
    "id, idcliente, tipo, numero, orgao_emissor, uf_emissor, pais_emissor, validade, \
     (scan IS NOT NULL) AS tem_scan, version, criado_em, atualizado_em";

#[async_trait]
impl DocumentoRepository for PgDocumentoRepository {
    async fn listar(&self, idcliente: i64) -> Result<Vec<ClienteDocumento>, DomainError> {
        sqlx::query_as::<_, ClienteDocumento>(&format!(
            "SELECT {DOC_COLS} FROM cliente_documento WHERE idcliente = $1
             ORDER BY tipo, id"
        ))
        .bind(idcliente)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn buscar(&self, id: i64) -> Result<Option<ClienteDocumento>, DomainError> {
        sqlx::query_as::<_, ClienteDocumento>(&format!(
            "SELECT {DOC_COLS} FROM cliente_documento WHERE id = $1"
        ))
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn criar(
        &self,
        novo: &NovoDocumento,
        log: NovoLog,
    ) -> Result<ClienteDocumento, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let d = sqlx::query_as::<_, ClienteDocumento>(&format!(
            "INSERT INTO cliente_documento
                (idcliente, tipo, numero, orgao_emissor, uf_emissor, pais_emissor, validade)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING {DOC_COLS}"
        ))
        .bind(novo.idcliente)
        .bind(&novo.tipo)
        .bind(&novo.numero)
        .bind(&novo.orgao_emissor)
        .bind(&novo.uf_emissor)
        .bind(&novo.pais_emissor)
        .bind(novo.validade)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;

        let mut log = log;
        log.idtabela = d.id;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(d)
    }

    async fn atualizar(
        &self,
        id: i64,
        d: &NovoDocumento,
        log: NovoLog,
    ) -> Result<ClienteDocumento, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let doc = sqlx::query_as::<_, ClienteDocumento>(&format!(
            "UPDATE cliente_documento SET
                tipo = $2, numero = $3, orgao_emissor = $4, uf_emissor = $5,
                pais_emissor = $6, validade = $7, atualizado_em = now()
             WHERE id = $1 AND ($8::bigint IS NULL OR version = $8)
             RETURNING {DOC_COLS}"
        ))
        .bind(id)
        .bind(&d.tipo)
        .bind(&d.numero)
        .bind(&d.orgao_emissor)
        .bind(&d.uf_emissor)
        .bind(&d.pais_emissor)
        .bind(d.validade)
        .bind(d.version)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| {
            DomainError::conflito(
                "Documento alterado por outro usuário. Recarregue e tente novamente.",
            )
        })?;

        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(doc)
    }

    async fn remover(&self, id: i64, log: NovoLog) -> Result<Option<String>, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let scan = sqlx::query_scalar::<_, Option<String>>(
            "DELETE FROM cliente_documento WHERE id = $1 RETURNING scan",
        )
        .bind(id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| DomainError::nao_encontrado("Documento não encontrado."))?;

        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(scan)
    }

    async fn definir_scan(
        &self,
        id: i64,
        caminho: Option<&str>,
        log: NovoLog,
    ) -> Result<(), DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let r = sqlx::query(
            "UPDATE cliente_documento SET scan = $2, atualizado_em = now() WHERE id = $1",
        )
        .bind(id)
        .bind(caminho)
        .execute(&mut *tx)
        .await
        .map_err(map_db_err)?;
        if r.rows_affected() == 0 {
            return Err(DomainError::nao_encontrado("Documento não encontrado."));
        }

        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(())
    }

    async fn scan_caminho(&self, id: i64) -> Result<Option<String>, DomainError> {
        sqlx::query_scalar::<_, Option<String>>("SELECT scan FROM cliente_documento WHERE id = $1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map(Option::flatten)
            .map_err(map_db_err)
    }
}
