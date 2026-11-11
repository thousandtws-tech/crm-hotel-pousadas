//! Adapters do catálogo: tipos, acomodações, quartos, estacionamento,
//! frigobar, formas de pagamento e estabelecimento.

use super::audit;
use crate::db::{map_db_err, map_del_err};
use async_trait::async_trait;
use clarituz_domain::entities::{
    Acomodacao, EnderecoEstabelecimento, Estabelecimento, FormaPagamento, Frigobar, ItemFrigobar,
    NovoLog, Quarto, TarifaHistorico, TipoAcomodacao, VagaEstacionamento,
};
use clarituz_domain::ports::{
    AcomodacaoRepository, AtualizaAcomodacao, DadosEndereco, DadosEstabelecimento,
    EstabelecimentoRepository, EstacionamentoRepository, FormaPagamentoRepository,
    FrigobarRepository, NovaAcomodacao, NovoFrigobar, QuartoRepository, TipoAcomodacaoRepository,
};
use clarituz_domain::queries::ItemFrigobarView;
use clarituz_domain::DomainError;
use clarituz_shared::{Page, PageParams};
use sqlx::PgPool;

// ===========================================================================
// Tipos de acomodação
// ===========================================================================

#[derive(Clone)]
pub struct PgTipoAcomodacaoRepository {
    pool: PgPool,
}
impl PgTipoAcomodacaoRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl TipoAcomodacaoRepository for PgTipoAcomodacaoRepository {
    async fn listar(&self, apenas_ativos: bool) -> Result<Vec<TipoAcomodacao>, DomainError> {
        sqlx::query_as::<_, TipoAcomodacao>(
            "SELECT id, nome, ativo, version, criado_em FROM tipo_acomodacao
             WHERE ($1::bool = false OR ativo) ORDER BY nome",
        )
        .bind(apenas_ativos)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn criar(&self, nome: &str, log: NovoLog) -> Result<TipoAcomodacao, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let t = sqlx::query_as::<_, TipoAcomodacao>(
            "INSERT INTO tipo_acomodacao (nome) VALUES ($1)
             RETURNING id, nome, ativo, version, criado_em",
        )
        .bind(nome)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;
        let mut log = log;
        log.idtabela = t.id;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(t)
    }

    async fn atualizar(
        &self,
        id: i64,
        nome: &str,
        version: Option<i64>,
        log: NovoLog,
    ) -> Result<TipoAcomodacao, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let t = sqlx::query_as::<_, TipoAcomodacao>(
            "UPDATE tipo_acomodacao SET nome = $2
             WHERE id = $1 AND ($3::bigint IS NULL OR version = $3)
             RETURNING id, nome, ativo, version, criado_em",
        )
        .bind(id)
        .bind(nome)
        .bind(version)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| {
            DomainError::conflito(
                "Tipo de acomodação alterado por outro usuário. Recarregue e tente novamente.",
            )
        })?;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(t)
    }

    async fn definir_ativo(
        &self,
        id: i64,
        ativo: bool,
        log: NovoLog,
    ) -> Result<TipoAcomodacao, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let t = sqlx::query_as::<_, TipoAcomodacao>(
            "UPDATE tipo_acomodacao SET ativo = $2 WHERE id = $1
             RETURNING id, nome, ativo, version, criado_em",
        )
        .bind(id)
        .bind(ativo)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| DomainError::nao_encontrado("Tipo de acomodação não encontrado."))?;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(t)
    }

    async fn remover(&self, id: i64, log: NovoLog) -> Result<(), DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let r = sqlx::query("DELETE FROM tipo_acomodacao WHERE id = $1")
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(|e| map_del_err(e, "Tipo em uso por acomodações — exclua-as primeiro."))?;
        if r.rows_affected() == 0 {
            return Err(DomainError::nao_encontrado(
                "Tipo de acomodação não encontrado.",
            ));
        }
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(())
    }
}

// ===========================================================================
// Acomodações
// ===========================================================================

#[derive(Clone)]
pub struct PgAcomodacaoRepository {
    pool: PgPool,
}
impl PgAcomodacaoRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

const ACOMODACAO_COLS: &str = "id, idtipo_acomodacao, nome, numero, andar, valor, capacidade,
    descricao, cor, ativo, version, criado_em, atualizado_em";

#[async_trait]
impl AcomodacaoRepository for PgAcomodacaoRepository {
    async fn buscar(&self, id: i64) -> Result<Option<Acomodacao>, DomainError> {
        sqlx::query_as::<_, Acomodacao>(&format!(
            "SELECT {ACOMODACAO_COLS} FROM acomodacao WHERE id = $1"
        ))
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn buscar_ativa_por_slug(&self, slug: &str) -> Result<Option<Acomodacao>, DomainError> {
        // `a.*` resolve a ambiguidade com `acomodacao_cms.id` no JOIN.
        sqlx::query_as::<_, Acomodacao>(
            "SELECT a.* FROM acomodacao a
             JOIN acomodacao_cms c ON c.idacomodacao = a.id
             WHERE c.slug = $1 AND a.ativo LIMIT 1",
        )
        .bind(slug)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn primeira_ativa(&self) -> Result<Option<Acomodacao>, DomainError> {
        sqlx::query_as::<_, Acomodacao>(&format!(
            "SELECT {ACOMODACAO_COLS} FROM acomodacao WHERE ativo ORDER BY numero LIMIT 1"
        ))
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn listar(
        &self,
        apenas_ativas: bool,
        page: PageParams,
    ) -> Result<Page<Acomodacao>, DomainError> {
        let where_ = "WHERE ($1::bool = false OR ativo)";
        let total =
            sqlx::query_scalar::<_, i64>(&format!("SELECT COUNT(*) FROM acomodacao {where_}"))
                .bind(apenas_ativas)
                .fetch_one(&self.pool)
                .await
                .map_err(map_db_err)?;

        let items = sqlx::query_as::<_, Acomodacao>(&format!(
            "SELECT {ACOMODACAO_COLS} FROM acomodacao {where_}
             ORDER BY numero LIMIT $2 OFFSET $3"
        ))
        .bind(apenas_ativas)
        .bind(page.limit())
        .bind(page.offset())
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)?;

        Ok(Page::new(items, page, total))
    }

    async fn numero_em_uso(&self, numero: i32, exceto_id: i64) -> Result<bool, DomainError> {
        sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM acomodacao WHERE numero = $1 AND id != $2)",
        )
        .bind(numero)
        .bind(exceto_id)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn criar(&self, nova: &NovaAcomodacao, log: NovoLog) -> Result<Acomodacao, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;

        let a = sqlx::query_as::<_, Acomodacao>(&format!(
            "INSERT INTO acomodacao
                (idtipo_acomodacao, nome, numero, andar, valor, capacidade, descricao, cor)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING {ACOMODACAO_COLS}"
        ))
        .bind(nova.idtipo_acomodacao)
        .bind(&nova.nome)
        .bind(nova.numero)
        .bind(nova.andar)
        .bind(nova.valor)
        .bind(nova.capacidade)
        .bind(&nova.descricao)
        .bind(&nova.cor)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;

        // paridade com o legado: cada acomodação nasce com um quarto físico
        if nova.criar_quarto {
            sqlx::query("INSERT INTO quarto (idacomodacao, numero) VALUES ($1, $2)")
                .bind(a.id)
                .bind(format!("Q{}", nova.numero))
                .execute(&mut *tx)
                .await
                .map_err(map_db_err)?;
        }

        sqlx::query(
            "INSERT INTO tarifa_historico (idacomodacao, valor, vigente_desde, idfuncionario)
             VALUES ($1, $2, CURRENT_DATE, $3)",
        )
        .bind(a.id)
        .bind(a.valor)
        .bind(log.idfuncionario)
        .execute(&mut *tx)
        .await
        .map_err(map_db_err)?;

        let mut log = log;
        log.idtabela = a.id;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(a)
    }

    async fn atualizar(
        &self,
        id: i64,
        d: &AtualizaAcomodacao,
        log: NovoLog,
    ) -> Result<Acomodacao, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;

        let antes: Option<rust_decimal::Decimal> =
            sqlx::query_scalar("SELECT valor FROM acomodacao WHERE id = $1")
                .bind(id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(map_db_err)?;
        if antes.is_none() {
            return Err(DomainError::nao_encontrado("Acomodação não encontrada."));
        }

        let a = sqlx::query_as::<_, Acomodacao>(&format!(
            "UPDATE acomodacao SET
                idtipo_acomodacao = COALESCE($2, idtipo_acomodacao),
                nome = COALESCE($3, nome),
                numero = COALESCE($4, numero),
                valor = COALESCE($5, valor),
                capacidade = COALESCE($6, capacidade),
                descricao = COALESCE($7, descricao),
                cor = COALESCE($8, cor),
                andar = COALESCE($10, andar),
                atualizado_em = now()
             WHERE id = $1 AND ($9::bigint IS NULL OR version = $9)
             RETURNING {ACOMODACAO_COLS}"
        ))
        .bind(id)
        .bind(d.idtipo_acomodacao)
        .bind(&d.nome)
        .bind(d.numero)
        .bind(d.valor)
        .bind(d.capacidade)
        .bind(&d.descricao)
        .bind(&d.cor)
        .bind(d.version)
        .bind(d.andar)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| {
            DomainError::conflito(
                "Acomodação alterada por outro usuário. Recarregue e tente novamente.",
            )
        })?;

        // trilha de preço: registra quando a tarifa muda
        if let (Some(antiga), Some(nova)) = (antes, d.valor) {
            if antiga != nova {
                sqlx::query(
                    "UPDATE tarifa_historico SET vigente_ate = CURRENT_DATE
                     WHERE idacomodacao = $1 AND vigente_ate IS NULL",
                )
                .bind(id)
                .execute(&mut *tx)
                .await
                .map_err(map_db_err)?;

                sqlx::query(
                    "INSERT INTO tarifa_historico (idacomodacao, valor, vigente_desde, idfuncionario)
                     VALUES ($1, $2, CURRENT_DATE, $3)",
                )
                .bind(id)
                .bind(nova)
                .bind(log.idfuncionario)
                .execute(&mut *tx)
                .await
                .map_err(map_db_err)?;
            }
        }

        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(a)
    }

    async fn definir_ativo(
        &self,
        id: i64,
        ativo: bool,
        log: NovoLog,
    ) -> Result<Acomodacao, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let a = sqlx::query_as::<_, Acomodacao>(&format!(
            "UPDATE acomodacao SET ativo = $2, atualizado_em = now()
             WHERE id = $1 RETURNING {ACOMODACAO_COLS}"
        ))
        .bind(id)
        .bind(ativo)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| DomainError::nao_encontrado("Acomodação não encontrada."))?;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(a)
    }

    async fn historico_tarifas(&self, id: i64) -> Result<Vec<TarifaHistorico>, DomainError> {
        sqlx::query_as::<_, TarifaHistorico>(
            "SELECT id, idacomodacao, valor, vigente_desde, vigente_ate, idfuncionario, criado_em
             FROM tarifa_historico WHERE idacomodacao = $1 ORDER BY id DESC",
        )
        .bind(id)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn contar_por_tipo(&self) -> Result<Vec<(String, i64)>, DomainError> {
        sqlx::query_as::<_, (String, i64)>(
            "SELECT COALESCE(t.nome, 'Sem tipo'), COUNT(a.id)
             FROM acomodacao a
             LEFT JOIN tipo_acomodacao t ON t.id = a.idtipo_acomodacao
             GROUP BY t.nome ORDER BY 1",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn remover(&self, id: i64, log: NovoLog) -> Result<Vec<String>, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        // reservas (idacomodacao e idquarto) bloqueiam a exclusão —
        // checar antes de tocar nos dependentes, senão o FK explode no meio do caminho
        let em_uso: bool = sqlx::query_scalar(
            "SELECT EXISTS(
                 SELECT 1 FROM reserva WHERE idacomodacao = $1
                    OR idquarto IN (SELECT id FROM quarto WHERE idacomodacao = $1)
             )",
        )
        .bind(id)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;
        if em_uso {
            return Err(DomainError::conflito(
                "Acomodação possui reservas — inative-a em vez de excluir.",
            ));
        }
        // chaves das mídias CMS — devolvidas para a API apagar no object store
        let midias: Vec<String> =
            sqlx::query_scalar("SELECT caminho FROM acomodacao_midia WHERE idacomodacao = $1")
                .bind(id)
                .fetch_all(&mut *tx)
                .await
                .map_err(map_db_err)?;
        sqlx::query("UPDATE estacionamento SET idacomodacao = NULL WHERE idacomodacao = $1")
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(map_db_err)?;
        sqlx::query(
            "DELETE FROM item_frigobar WHERE idfrigobar IN
             (SELECT id FROM frigobar WHERE idacomodacao = $1)",
        )
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(map_db_err)?;
        sqlx::query("DELETE FROM frigobar WHERE idacomodacao = $1")
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(map_db_err)?;
        sqlx::query("DELETE FROM quarto WHERE idacomodacao = $1")
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(map_db_err)?;
        sqlx::query("DELETE FROM tarifa_historico WHERE idacomodacao = $1")
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(map_db_err)?;
        // acomodacao_cms e acomodacao_midia caem por ON DELETE CASCADE
        let r = sqlx::query("DELETE FROM acomodacao WHERE id = $1")
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(|e| {
                map_del_err(
                    e,
                    "Acomodação possui reservas — inative-a em vez de excluir.",
                )
            })?;
        if r.rows_affected() == 0 {
            return Err(DomainError::nao_encontrado("Acomodação não encontrada."));
        }
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(midias)
    }
}

// ===========================================================================
// Quartos
// ===========================================================================

#[derive(Clone)]
pub struct PgQuartoRepository {
    pool: PgPool,
}
impl PgQuartoRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl QuartoRepository for PgQuartoRepository {
    async fn listar_por_acomodacao(&self, idacomodacao: i64) -> Result<Vec<Quarto>, DomainError> {
        sqlx::query_as::<_, Quarto>(
            "SELECT id, idacomodacao, numero, ativo, version, criado_em
             FROM quarto WHERE idacomodacao = $1 ORDER BY numero",
        )
        .bind(idacomodacao)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn criar(
        &self,
        idacomodacao: i64,
        numero: &str,
        log: NovoLog,
    ) -> Result<Quarto, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let q = sqlx::query_as::<_, Quarto>(
            "INSERT INTO quarto (idacomodacao, numero) VALUES ($1, $2)
             RETURNING id, idacomodacao, numero, ativo, version, criado_em",
        )
        .bind(idacomodacao)
        .bind(numero)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;
        let mut log = log;
        log.idtabela = q.id;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(q)
    }

    async fn definir_ativo(
        &self,
        id: i64,
        ativo: bool,
        log: NovoLog,
    ) -> Result<Quarto, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let q = sqlx::query_as::<_, Quarto>(
            "UPDATE quarto SET ativo = $2 WHERE id = $1
             RETURNING id, idacomodacao, numero, ativo, version, criado_em",
        )
        .bind(id)
        .bind(ativo)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| DomainError::nao_encontrado("Quarto não encontrado."))?;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(q)
    }

    async fn remover(&self, id: i64, log: NovoLog) -> Result<(), DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let r = sqlx::query("DELETE FROM quarto WHERE id = $1")
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(|e| map_del_err(e, "Quarto possui reservas vinculadas — inative-o."))?;
        if r.rows_affected() == 0 {
            return Err(DomainError::nao_encontrado("Quarto não encontrado."));
        }
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(())
    }
}

// ===========================================================================
// Estacionamento
// ===========================================================================

#[derive(Clone)]
pub struct PgEstacionamentoRepository {
    pool: PgPool,
}
impl PgEstacionamentoRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

const VAGA_COLS: &str = "id, idacomodacao, numero, ativo, version, criado_em";

#[async_trait]
impl EstacionamentoRepository for PgEstacionamentoRepository {
    async fn listar(&self) -> Result<Vec<VagaEstacionamento>, DomainError> {
        sqlx::query_as::<_, VagaEstacionamento>(&format!(
            "SELECT {VAGA_COLS} FROM estacionamento ORDER BY numero"
        ))
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn criar(&self, numero: &str, log: NovoLog) -> Result<VagaEstacionamento, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let v = sqlx::query_as::<_, VagaEstacionamento>(&format!(
            "INSERT INTO estacionamento (numero) VALUES ($1) RETURNING {VAGA_COLS}"
        ))
        .bind(numero)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;
        let mut log = log;
        log.idtabela = v.id;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(v)
    }

    async fn vincular_acomodacao(
        &self,
        id: i64,
        idacomodacao: Option<i64>,
        log: NovoLog,
    ) -> Result<VagaEstacionamento, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let v = sqlx::query_as::<_, VagaEstacionamento>(&format!(
            "UPDATE estacionamento SET idacomodacao = $2 WHERE id = $1 RETURNING {VAGA_COLS}"
        ))
        .bind(id)
        .bind(idacomodacao)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| DomainError::nao_encontrado("Vaga não encontrada."))?;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(v)
    }

    async fn definir_ativo(
        &self,
        id: i64,
        ativo: bool,
        log: NovoLog,
    ) -> Result<VagaEstacionamento, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let v = sqlx::query_as::<_, VagaEstacionamento>(&format!(
            "UPDATE estacionamento SET ativo = $2 WHERE id = $1 RETURNING {VAGA_COLS}"
        ))
        .bind(id)
        .bind(ativo)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| DomainError::nao_encontrado("Vaga não encontrada."))?;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(v)
    }

    async fn remover(&self, id: i64, log: NovoLog) -> Result<(), DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let r = sqlx::query("DELETE FROM estacionamento WHERE id = $1")
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(map_db_err)?;
        if r.rows_affected() == 0 {
            return Err(DomainError::nao_encontrado("Vaga não encontrada."));
        }
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(())
    }
}

// ===========================================================================
// Frigobar
// ===========================================================================

#[derive(Clone)]
pub struct PgFrigobarRepository {
    pool: PgPool,
}
impl PgFrigobarRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

const FRIGOBAR_COLS: &str = "id, idacomodacao, modelo, patrimonio, ativo, version, criado_em";

#[async_trait]
impl FrigobarRepository for PgFrigobarRepository {
    async fn buscar(&self, id: i64) -> Result<Option<Frigobar>, DomainError> {
        sqlx::query_as::<_, Frigobar>(&format!(
            "SELECT {FRIGOBAR_COLS} FROM frigobar WHERE id = $1"
        ))
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn listar(&self) -> Result<Vec<Frigobar>, DomainError> {
        sqlx::query_as::<_, Frigobar>(&format!("SELECT {FRIGOBAR_COLS} FROM frigobar ORDER BY id"))
            .fetch_all(&self.pool)
            .await
            .map_err(map_db_err)
    }

    async fn listar_por_acomodacao(&self, idacomodacao: i64) -> Result<Vec<Frigobar>, DomainError> {
        sqlx::query_as::<_, Frigobar>(&format!(
            "SELECT {FRIGOBAR_COLS} FROM frigobar WHERE idacomodacao = $1 AND ativo ORDER BY id"
        ))
        .bind(idacomodacao)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn criar(&self, novo: &NovoFrigobar, log: NovoLog) -> Result<Frigobar, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let f = sqlx::query_as::<_, Frigobar>(&format!(
            "INSERT INTO frigobar (idacomodacao, modelo, patrimonio) VALUES ($1,$2,$3)
             RETURNING {FRIGOBAR_COLS}"
        ))
        .bind(novo.idacomodacao)
        .bind(&novo.modelo)
        .bind(&novo.patrimonio)
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
        d: &NovoFrigobar,
        log: NovoLog,
    ) -> Result<Frigobar, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let f = sqlx::query_as::<_, Frigobar>(&format!(
            "UPDATE frigobar SET idacomodacao = $2, modelo = $3, patrimonio = $4
             WHERE id = $1 AND ($5::bigint IS NULL OR version = $5)
             RETURNING {FRIGOBAR_COLS}"
        ))
        .bind(id)
        .bind(d.idacomodacao)
        .bind(&d.modelo)
        .bind(&d.patrimonio)
        .bind(d.version)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| {
            DomainError::conflito(
                "Frigobar alterado por outro usuário. Recarregue e tente novamente.",
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
    ) -> Result<Frigobar, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let f = sqlx::query_as::<_, Frigobar>(&format!(
            "UPDATE frigobar SET ativo = $2 WHERE id = $1 RETURNING {FRIGOBAR_COLS}"
        ))
        .bind(id)
        .bind(ativo)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| DomainError::nao_encontrado("Frigobar não encontrado."))?;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(f)
    }

    async fn listar_itens(&self, idfrigobar: i64) -> Result<Vec<ItemFrigobarView>, DomainError> {
        sqlx::query_as::<_, ItemFrigobarView>(
            "SELECT i.id, i.idfrigobar, i.iditem, e.nome AS item_nome,
                    e.valor_unitario, i.quantidade, i.ativo
             FROM item_frigobar i
             JOIN estoque e ON e.id = i.iditem
             WHERE i.idfrigobar = $1
             ORDER BY e.nome",
        )
        .bind(idfrigobar)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn repor_item(
        &self,
        idfrigobar: i64,
        iditem: i64,
        quantidade: i32,
        idfuncionario: i64,
        log: NovoLog,
    ) -> Result<ItemFrigobar, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;

        // debita o estoque central — CHECK(quantidade >= 0) barra saldo negativo
        let upd = sqlx::query(
            "UPDATE estoque SET quantidade = quantidade - $2, atualizado_em = now()
             WHERE id = $1 AND ativo",
        )
        .bind(iditem)
        .bind(quantidade)
        .execute(&mut *tx)
        .await
        .map_err(map_db_err)?;
        if upd.rows_affected() == 0 {
            return Err(DomainError::nao_encontrado(
                "Item de estoque não encontrado.",
            ));
        }

        sqlx::query(
            "INSERT INTO movimento_estoque (iditem, tipo, quantidade, idfuncionario, motivo)
             VALUES ($1, 'saida', $2, $3, 'reposição frigobar')",
        )
        .bind(iditem)
        .bind(quantidade)
        .bind(idfuncionario)
        .execute(&mut *tx)
        .await
        .map_err(map_db_err)?;

        // upsert no slot do frigobar
        let item = sqlx::query_as::<_, ItemFrigobar>(
            "INSERT INTO item_frigobar (idfrigobar, iditem, quantidade)
             VALUES ($1, $2, $3)
             ON CONFLICT (idfrigobar, iditem)
             DO UPDATE SET quantidade = item_frigobar.quantidade + $3, ativo = true
             RETURNING id, idfrigobar, iditem, quantidade, ativo, version, criado_em",
        )
        .bind(idfrigobar)
        .bind(iditem)
        .bind(quantidade)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;

        let mut log = log;
        log.idtabela = item.id;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(item)
    }

    async fn atualizar_item(
        &self,
        id: i64,
        quantidade: i32,
        version: Option<i64>,
        log: NovoLog,
    ) -> Result<ItemFrigobar, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let item = sqlx::query_as::<_, ItemFrigobar>(
            "UPDATE item_frigobar SET quantidade = $2
             WHERE id = $1 AND ($3::bigint IS NULL OR version = $3)
             RETURNING id, idfrigobar, iditem, quantidade, ativo, version, criado_em",
        )
        .bind(id)
        .bind(quantidade)
        .bind(version)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| {
            DomainError::conflito(
                "Item de frigobar alterado por outro usuário. Recarregue e tente novamente.",
            )
        })?;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(item)
    }

    async fn definir_item_ativo(
        &self,
        id: i64,
        ativo: bool,
        log: NovoLog,
    ) -> Result<(), DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let r = sqlx::query("UPDATE item_frigobar SET ativo = $2 WHERE id = $1")
            .bind(id)
            .bind(ativo)
            .execute(&mut *tx)
            .await
            .map_err(map_db_err)?;
        if r.rows_affected() == 0 {
            return Err(DomainError::nao_encontrado(
                "Item de frigobar não encontrado.",
            ));
        }
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(())
    }

    async fn remover_item(&self, id: i64, log: NovoLog) -> Result<(), DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let r = sqlx::query("DELETE FROM item_frigobar WHERE id = $1")
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(map_db_err)?;
        if r.rows_affected() == 0 {
            return Err(DomainError::nao_encontrado(
                "Item de frigobar não encontrado.",
            ));
        }
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(())
    }

    async fn remover(&self, id: i64, log: NovoLog) -> Result<(), DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        sqlx::query("DELETE FROM item_frigobar WHERE idfrigobar = $1")
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(map_db_err)?;
        let r = sqlx::query("DELETE FROM frigobar WHERE id = $1")
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(map_db_err)?;
        if r.rows_affected() == 0 {
            return Err(DomainError::nao_encontrado("Frigobar não encontrado."));
        }
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(())
    }
}

// ===========================================================================
// Formas de pagamento
// ===========================================================================

#[derive(Clone)]
pub struct PgFormaPagamentoRepository {
    pool: PgPool,
}
impl PgFormaPagamentoRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

const FORMA_COLS: &str = "id, nome, ativo, version, criado_em";

#[async_trait]
impl FormaPagamentoRepository for PgFormaPagamentoRepository {
    async fn buscar(&self, id: i64) -> Result<Option<FormaPagamento>, DomainError> {
        sqlx::query_as::<_, FormaPagamento>(&format!(
            "SELECT {FORMA_COLS} FROM forma_pagamento WHERE id = $1"
        ))
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn listar(&self, apenas_ativas: bool) -> Result<Vec<FormaPagamento>, DomainError> {
        sqlx::query_as::<_, FormaPagamento>(
            "SELECT id, nome, ativo, version, criado_em FROM forma_pagamento
             WHERE ($1::bool = false OR ativo) ORDER BY nome",
        )
        .bind(apenas_ativas)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn criar(&self, nome: &str, log: NovoLog) -> Result<FormaPagamento, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let f = sqlx::query_as::<_, FormaPagamento>(&format!(
            "INSERT INTO forma_pagamento (nome) VALUES ($1) RETURNING {FORMA_COLS}"
        ))
        .bind(nome)
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
        nome: &str,
        version: Option<i64>,
        log: NovoLog,
    ) -> Result<FormaPagamento, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let f = sqlx::query_as::<_, FormaPagamento>(&format!(
            "UPDATE forma_pagamento SET nome = $2
             WHERE id = $1 AND ($3::bigint IS NULL OR version = $3)
             RETURNING {FORMA_COLS}"
        ))
        .bind(id)
        .bind(nome)
        .bind(version)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| {
            DomainError::conflito(
                "Forma de pagamento alterada por outro usuário. Recarregue e tente novamente.",
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
    ) -> Result<FormaPagamento, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let f = sqlx::query_as::<_, FormaPagamento>(&format!(
            "UPDATE forma_pagamento SET ativo = $2 WHERE id = $1 RETURNING {FORMA_COLS}"
        ))
        .bind(id)
        .bind(ativo)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?
        .ok_or_else(|| DomainError::nao_encontrado("Forma de pagamento não encontrada."))?;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(f)
    }

    async fn remover(&self, id: i64, log: NovoLog) -> Result<(), DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let r = sqlx::query("DELETE FROM forma_pagamento WHERE id = $1")
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(|e| map_del_err(e, "Forma de pagamento já usada em consumos — inative-a."))?;
        if r.rows_affected() == 0 {
            return Err(DomainError::nao_encontrado(
                "Forma de pagamento não encontrada.",
            ));
        }
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(())
    }
}

// ===========================================================================
// Estabelecimento
// ===========================================================================

#[derive(Clone)]
pub struct PgEstabelecimentoRepository {
    pool: PgPool,
}
impl PgEstabelecimentoRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl EstabelecimentoRepository for PgEstabelecimentoRepository {
    async fn obter(&self) -> Result<Option<Estabelecimento>, DomainError> {
        sqlx::query_as::<_, Estabelecimento>(
            "SELECT id, cnpj, razao_social, site, email, telefone, celular,
                    impressora_ip, impressora_porta, impressora_ativa, taxa_early, taxa_late,
                    wifi_nome, wifi_senha, horario_checkin, horario_checkout, horario_cafe, info_servicos,
                    cadastur, politica_cancelamento, retencao_dados_anos, dpo_email,
                    version, criado_em, atualizado_em
             FROM estabelecimento ORDER BY id LIMIT 1",
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn obter_endereco(&self) -> Result<Option<EnderecoEstabelecimento>, DomainError> {
        sqlx::query_as::<_, EnderecoEstabelecimento>(
            "SELECT id, idestabelecimento, logradouro, numero, complemento, bairro, cidade, cep, version, criado_em
             FROM endereco_estabelecimento ORDER BY id DESC LIMIT 1",
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn salvar_dados(
        &self,
        d: &DadosEstabelecimento,
        log: NovoLog,
    ) -> Result<Estabelecimento, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let e = sqlx::query_as::<_, Estabelecimento>(
            "INSERT INTO estabelecimento
                (cnpj, razao_social, site, email, telefone, celular,
                 impressora_ip, impressora_porta, impressora_ativa, taxa_early, taxa_late,
                 wifi_nome, wifi_senha, horario_checkin, horario_checkout, horario_cafe, info_servicos,
                 cadastur, politica_cancelamento, retencao_dados_anos, dpo_email)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
                     $18, $19, $20, $21)
             ON CONFLICT (id) DO NOTHING
             RETURNING id, cnpj, razao_social, site, email, telefone, celular,
                       impressora_ip, impressora_porta, impressora_ativa, taxa_early, taxa_late,
                       wifi_nome, wifi_senha, horario_checkin, horario_checkout, horario_cafe, info_servicos,
                       cadastur, politica_cancelamento, retencao_dados_anos, dpo_email,
                       version, criado_em, atualizado_em",
        )
        .bind(&d.cnpj)
        .bind(&d.razao_social)
        .bind(&d.site)
        .bind(&d.email)
        .bind(&d.telefone)
        .bind(&d.celular)
        .bind(&d.impressora_ip)
        .bind(d.impressora_porta)
        .bind(d.impressora_ativa)
        .bind(d.taxa_early)
        .bind(d.taxa_late)
        .bind(&d.wifi_nome)
        .bind(&d.wifi_senha)
        .bind(&d.horario_checkin)
        .bind(&d.horario_checkout)
        .bind(&d.horario_cafe)
        .bind(&d.info_servicos)
        .bind(&d.cadastur)
        .bind(&d.politica_cancelamento)
        .bind(d.retencao_dados_anos)
        .bind(&d.dpo_email)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_db_err)?;

        let e = match e {
            Some(e) => e,
            None => {
                sqlx::query_as::<_, Estabelecimento>(
                    "UPDATE estabelecimento SET
                        cnpj = $1, razao_social = $2, site = $3, email = $4,
                        telefone = $5, celular = $6,
                        impressora_ip = $7, impressora_porta = $8, impressora_ativa = $9,
                        taxa_early = $10, taxa_late = $11,
                        wifi_nome = $13, wifi_senha = $14, horario_checkin = $15,
                        horario_checkout = $16, horario_cafe = $17, info_servicos = $18,
                        cadastur = $19, politica_cancelamento = $20,
                        retencao_dados_anos = $21, dpo_email = $22,
                        version = version + 1,
                        atualizado_em = now()
                     WHERE id = (SELECT id FROM estabelecimento ORDER BY id LIMIT 1)
                       AND ($12::bigint IS NULL OR version = $12)
                     RETURNING id, cnpj, razao_social, site, email, telefone, celular,
                               impressora_ip, impressora_porta, impressora_ativa, taxa_early, taxa_late,
                               wifi_nome, wifi_senha, horario_checkin, horario_checkout, horario_cafe, info_servicos,
                               cadastur, politica_cancelamento, retencao_dados_anos, dpo_email,
                               version, criado_em, atualizado_em",
                )
                .bind(&d.cnpj)
                .bind(&d.razao_social)
                .bind(&d.site)
                .bind(&d.email)
                .bind(&d.telefone)
                .bind(&d.celular)
                .bind(&d.impressora_ip)
                .bind(d.impressora_porta)
                .bind(d.impressora_ativa)
                .bind(d.taxa_early)
                .bind(d.taxa_late)
                .bind(d.version)
                .bind(&d.wifi_nome)
                .bind(&d.wifi_senha)
                .bind(&d.horario_checkin)
                .bind(&d.horario_checkout)
                .bind(&d.horario_cafe)
                .bind(&d.info_servicos)
                .bind(&d.cadastur)
                .bind(&d.politica_cancelamento)
                .bind(d.retencao_dados_anos)
                .bind(&d.dpo_email)
                .fetch_optional(&mut *tx)
                .await
                .map_err(map_db_err)?
                .ok_or_else(|| {
                    DomainError::conflito(
                        "Dados do estabelecimento alterados por outro usuário. Recarregue e tente novamente.",
                    )
                })?
            }
        };

        let mut log = log;
        log.idtabela = e.id;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(e)
    }

    async fn salvar_endereco(
        &self,
        d: &DadosEndereco,
        log: NovoLog,
    ) -> Result<EnderecoEstabelecimento, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;

        let idest =
            sqlx::query_scalar::<_, i64>("SELECT id FROM estabelecimento ORDER BY id LIMIT 1")
                .fetch_optional(&mut *tx)
                .await
                .map_err(map_db_err)?
                .ok_or_else(|| {
                    DomainError::regra("Cadastre os dados do estabelecimento antes do endereço.")
                })?;

        let e = sqlx::query_as::<_, EnderecoEstabelecimento>(
            "INSERT INTO endereco_estabelecimento
                (idestabelecimento, logradouro, numero, complemento, bairro, cidade, cep)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id, idestabelecimento, logradouro, numero, complemento, bairro, cidade, cep, version, criado_em",
        )
        .bind(idest)
        .bind(&d.logradouro)
        .bind(&d.numero)
        .bind(&d.complemento)
        .bind(&d.bairro)
        .bind(&d.cidade)
        .bind(&d.cep)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;

        let mut log = log;
        log.idtabela = e.id;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(e)
    }

    async fn definir_logo(
        &self,
        nome: &str,
        caminho: &str,
        log: NovoLog,
    ) -> Result<(), DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        sqlx::query("DELETE FROM logo_estabelecimento")
            .execute(&mut *tx)
            .await
            .map_err(map_db_err)?;
        sqlx::query("INSERT INTO logo_estabelecimento (nome, caminho) VALUES ($1, $2)")
            .bind(nome)
            .bind(caminho)
            .execute(&mut *tx)
            .await
            .map_err(map_db_err)?;
        audit::gravar(&mut *tx, &log).await?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(())
    }

    async fn logo_atual(&self) -> Result<Option<(String, String)>, DomainError> {
        sqlx::query_as::<_, (String, String)>(
            "SELECT nome, caminho FROM logo_estabelecimento ORDER BY id DESC LIMIT 1",
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)
    }
}
