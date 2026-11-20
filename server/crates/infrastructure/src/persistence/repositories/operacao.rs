//! Repositórios operacionais — manutenção/PMOC, governança/lavanderia
//! e escalas. Transações atômicas onde há efeito colateral (fechamento
//! de lavanderia → conta a pagar, mesma regra das compras).

use async_trait::async_trait;
use chrono::{DateTime, NaiveDate, Utc};
use clarituz_domain::entities::*;
use clarituz_domain::enums::{OrigemTurno, StatusManut, StatusTarefaGov};
use clarituz_domain::error::DomainError;
use clarituz_domain::ports::*;
use sqlx::PgPool;

use crate::persistence::db::map_db_err;

const MANUT_COLS: &str =
    "id,idquarto,local,titulo,descricao,prioridade,status,custo_centavos,materiais,
     responsavel,idfuncionario,criado_por,aberta_em,concluida_em,version";
const GOV_COLS: &str = "id,idquarto,data,tipo,status,estimado_min,idfuncionario,origem,observacao,
     concluida_em,criado_em,version";
const LOTE_COLS: &str = "id,fornecedor,competencia,enviado_em,devolvido_em,qtd_itens,qtd_devolvida,
     custo_centavos,status,idlancamento,observacao";
const TURNO_COLS: &str = "id,idfuncionario,data,inicio,fim,almoco_min,origem,version";

// ---------------------------------------------------------------------------
// manutenção & PMOC
// ---------------------------------------------------------------------------

pub struct PgManutencaoRepository {
    pool: PgPool,
}

impl PgManutencaoRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl ManutencaoRepository for PgManutencaoRepository {
    async fn criar_ordem(&self, o: &NovaOrdem) -> Result<ManutencaoOrdem, DomainError> {
        sqlx::query_as::<_, ManutencaoOrdem>(&format!(
            "INSERT INTO manutencao_ordem
                (idquarto,local,titulo,descricao,prioridade,materiais,responsavel,idfuncionario,criado_por)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING {MANUT_COLS}"
        ))
        .bind(o.idquarto)
        .bind(&o.local)
        .bind(&o.titulo)
        .bind(&o.descricao)
        .bind(o.prioridade)
        .bind(&o.materiais)
        .bind(&o.responsavel)
        .bind(o.idfuncionario)
        .bind(o.criado_por)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn ordens(
        &self,
        status: Option<StatusManut>,
    ) -> Result<Vec<ManutencaoOrdem>, DomainError> {
        let q = match status {
            Some(_) => format!(
                "SELECT {MANUT_COLS} FROM manutencao_ordem WHERE status=$1
                 ORDER BY prioridade DESC, aberta_em"
            ),
            None => format!(
                "SELECT {MANUT_COLS} FROM manutencao_ordem
                 WHERE status NOT IN ('concluida','cancelada')
                 ORDER BY prioridade DESC, aberta_em LIMIT 300"
            ),
        };
        let mut qb = sqlx::query_as::<_, ManutencaoOrdem>(&q);
        if let Some(s) = status {
            qb = qb.bind(s);
        }
        qb.fetch_all(&self.pool).await.map_err(map_db_err)
    }

    async fn mudar_status(
        &self,
        id: i64,
        status: StatusManut,
        custo_centavos: Option<i64>,
    ) -> Result<ManutencaoOrdem, DomainError> {
        let concluida = matches!(status, StatusManut::Concluida);
        sqlx::query_as::<_, ManutencaoOrdem>(&format!(
            "UPDATE manutencao_ordem SET status=$2,
                custo_centavos=COALESCE($3,custo_centavos),
                concluida_em = CASE WHEN $4 THEN now() ELSE concluida_em END
             WHERE id=$1 RETURNING {MANUT_COLS}"
        ))
        .bind(id)
        .bind(status)
        .bind(custo_centavos)
        .bind(concluida)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn pmoc_registrar(&self, r: &NovoPmoc) -> Result<PmocRegistro, DomainError> {
        sqlx::query_as::<_, PmocRegistro>(
            "INSERT INTO pmoc_registro
                (referente_a,itens,conformes,responsavel_nome,responsavel_crea,
                 responsavel_art,observacoes,proxima_data,criado_por)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             RETURNING id,referente_a,itens,conformes,responsavel_nome,
                 responsavel_crea,responsavel_art,observacoes,proxima_data,
                 criado_por,criado_em",
        )
        .bind(r.referente_a)
        .bind(&r.itens)
        .bind(r.conformes)
        .bind(&r.responsavel_nome)
        .bind(&r.responsavel_crea)
        .bind(&r.responsavel_art)
        .bind(&r.observacoes)
        .bind(r.proxima_data)
        .bind(r.criado_por)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn pmoc_listar(&self) -> Result<Vec<PmocRegistro>, DomainError> {
        sqlx::query_as::<_, PmocRegistro>(
            "SELECT id,referente_a,itens,conformes,responsavel_nome,responsavel_crea,
                    responsavel_art,observacoes,proxima_data,criado_por,criado_em
             FROM pmoc_registro ORDER BY referente_a DESC LIMIT 60",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn pmoc_atraso(&self, hoje: NaiveDate) -> Result<Option<PmocRegistro>, DomainError> {
        sqlx::query_as::<_, PmocRegistro>(
            "SELECT id,referente_a,itens,conformes,responsavel_nome,responsavel_crea,
                    responsavel_art,observacoes,proxima_data,criado_por,criado_em
             FROM pmoc_registro
             WHERE proxima_data IS NOT NULL AND proxima_data < $1
             ORDER BY proxima_data LIMIT 1",
        )
        .bind(hoje)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)
    }
}

// ---------------------------------------------------------------------------
// governança
// ---------------------------------------------------------------------------

pub struct PgGovernancaRepository {
    pool: PgPool,
}

impl PgGovernancaRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl GovernancaRepository for PgGovernancaRepository {
    async fn tarefas_dia(&self, data: NaiveDate) -> Result<Vec<GovernancaTarefa>, DomainError> {
        sqlx::query_as::<_, GovernancaTarefa>(&format!(
            "SELECT {GOV_COLS} FROM governanca_tarefa WHERE data=$1
             ORDER BY tipo, idquarto"
        ))
        .bind(data)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn tarefas_periodo(
        &self,
        inicio: NaiveDate,
        fim: NaiveDate,
    ) -> Result<Vec<GovernancaTarefa>, DomainError> {
        sqlx::query_as::<_, GovernancaTarefa>(&format!(
            "SELECT {GOV_COLS} FROM governanca_tarefa
             WHERE data BETWEEN $1 AND $2 ORDER BY data, tipo, idquarto"
        ))
        .bind(inicio)
        .bind(fim)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn criar_tarefa(&self, t: &NovaTarefa) -> Result<GovernancaTarefa, DomainError> {
        sqlx::query_as::<_, GovernancaTarefa>(&format!(
            "INSERT INTO governanca_tarefa
                (idquarto,data,tipo,estimado_min,idfuncionario,origem,observacao)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING {GOV_COLS}"
        ))
        .bind(t.idquarto)
        .bind(t.data)
        .bind(t.tipo)
        .bind(t.estimado_min)
        .bind(t.idfuncionario)
        .bind(&t.origem)
        .bind(&t.observacao)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn criar_tarefa_se_ausente(&self, t: &NovaTarefa) -> Result<bool, DomainError> {
        let n = sqlx::query(
            "INSERT INTO governanca_tarefa
                (idquarto,data,tipo,estimado_min,idfuncionario,origem,observacao)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (idquarto,data,tipo) WHERE idquarto IS NOT NULL DO NOTHING",
        )
        .bind(t.idquarto)
        .bind(t.data)
        .bind(t.tipo)
        .bind(t.estimado_min)
        .bind(t.idfuncionario)
        .bind(&t.origem)
        .bind(&t.observacao)
        .execute(&self.pool)
        .await
        .map_err(map_db_err)?;
        Ok(n.rows_affected() > 0)
    }

    async fn mudar_status_tarefa(
        &self,
        id: i64,
        status: StatusTarefaGov,
    ) -> Result<GovernancaTarefa, DomainError> {
        let concluida = matches!(status, StatusTarefaGov::Concluida);
        sqlx::query_as::<_, GovernancaTarefa>(&format!(
            "UPDATE governanca_tarefa SET status=$2,
                concluida_em = CASE WHEN $3 THEN now() ELSE NULL END
             WHERE id=$1 RETURNING {GOV_COLS}"
        ))
        .bind(id)
        .bind(status)
        .bind(concluida)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn atribuir(&self, id: i64, idfuncionario: i64) -> Result<GovernancaTarefa, DomainError> {
        sqlx::query_as::<_, GovernancaTarefa>(&format!(
            "UPDATE governanca_tarefa SET idfuncionario=$2 WHERE id=$1 RETURNING {GOV_COLS}"
        ))
        .bind(id)
        .bind(idfuncionario)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn checkouts_do_dia(&self, data: NaiveDate) -> Result<Vec<i64>, DomainError> {
        sqlx::query_scalar(
            "SELECT DISTINCT idquarto FROM reserva
             WHERE saidaprevista=$1 AND status IN ('i','f')
               AND idquarto IS NOT NULL",
        )
        .bind(data)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn stayovers_do_dia(&self, data: NaiveDate) -> Result<Vec<i64>, DomainError> {
        sqlx::query_scalar(
            "SELECT DISTINCT idquarto FROM reserva
             WHERE entradaprevista < $1 AND saidaprevista > $1
               AND status IN ('i','p') AND idquarto IS NOT NULL",
        )
        .bind(data)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn capacidade_governanca_min(&self, data: NaiveDate) -> Result<i64, DomainError> {
        let min: Option<i64> = sqlx::query_scalar(
            "SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (t.fim - t.inicio))/60 - t.almoco_min),0)::bigint
             FROM escala_turno t JOIN funcionario f ON f.id = t.idfuncionario
             WHERE t.data=$1 AND f.setor='governanca' AND f.ativo",
        )
        .bind(data)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)?;
        Ok(min.unwrap_or(0))
    }

    async fn lav_lotes(
        &self,
        competencia: Option<NaiveDate>,
    ) -> Result<Vec<LavanderiaLote>, DomainError> {
        match competencia {
            Some(c) => sqlx::query_as::<_, LavanderiaLote>(&format!(
                "SELECT {LOTE_COLS} FROM lavanderia_lote WHERE competencia=$1 ORDER BY enviado_em DESC"
            ))
            .bind(c)
            .fetch_all(&self.pool)
            .await
            .map_err(map_db_err),
            None => sqlx::query_as::<_, LavanderiaLote>(&format!(
                "SELECT {LOTE_COLS} FROM lavanderia_lote ORDER BY enviado_em DESC LIMIT 60"
            ))
            .fetch_all(&self.pool)
            .await
            .map_err(map_db_err),
        }
    }

    async fn lav_abrir(&self, l: &NovoLote) -> Result<LavanderiaLote, DomainError> {
        sqlx::query_as::<_, LavanderiaLote>(&format!(
            "INSERT INTO lavanderia_lote (fornecedor,competencia,qtd_itens,custo_centavos,observacao)
             VALUES ($1,$2,$3,$4,$5) RETURNING {LOTE_COLS}"
        ))
        .bind(&l.fornecedor)
        .bind(l.competencia)
        .bind(l.qtd_itens)
        .bind(l.custo_centavos)
        .bind(&l.observacao)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn lav_devolver(
        &self,
        id: i64,
        qtd_devolvida: i32,
        custo_centavos: Option<i64>,
    ) -> Result<LavanderiaLote, DomainError> {
        sqlx::query_as::<_, LavanderiaLote>(&format!(
            "UPDATE lavanderia_lote SET
                qtd_devolvida = qtd_devolvida + $2,
                custo_centavos = COALESCE($3, custo_centavos),
                devolvido_em = now(),
                status = CASE WHEN qtd_devolvida + $2 >= qtd_itens
                              THEN 'devolvido'::status_lote_lav
                              ELSE 'devolvido_parcial'::status_lote_lav END
             WHERE id=$1 AND status <> 'fechado' RETURNING {LOTE_COLS}"
        ))
        .bind(id)
        .bind(qtd_devolvida)
        .bind(custo_centavos)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn lav_fechar_competencia(&self, competencia: NaiveDate) -> Result<i64, DomainError> {
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        // Anti-duplicação: competência já fechada aborta.
        let abertos: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM lavanderia_lote
             WHERE competencia=$1 AND status <> 'fechado'",
        )
        .bind(competencia)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;
        if abertos == 0 {
            return Err(DomainError::regra("competência já fechada ou sem lotes"));
        }
        let total: i64 = sqlx::query_scalar(
            "SELECT COALESCE(SUM(custo_centavos),0)::bigint FROM lavanderia_lote
             WHERE competencia=$1 AND status <> 'fechado'",
        )
        .bind(competencia)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;
        // Conta a pagar consolidada da competência (valor em reais, plano 4.04).
        let idlanc: i64 = sqlx::query_scalar(
            "INSERT INTO lancamento
                (tipo, descricao, idplano_conta, favorecido, valor,
                 emissao, vencimento, competencia, status, observacao)
             VALUES ('pagar', $1,
                     (SELECT id FROM plano_conta WHERE codigo = '4.04'),
                     'Lavanderia terceirizada', $2,
                     CURRENT_DATE, $3, $1, 'aberto', $4)
             RETURNING id",
        )
        .bind(competencia)
        .bind(rust_decimal::Decimal::new(total, 2))
        .bind(competencia + chrono::Duration::days(30))
        .bind(format!(
            "Lavanderia — fechamento {}",
            competencia.format("%m/%Y")
        ))
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;
        sqlx::query(
            "UPDATE lavanderia_lote SET status='fechado', idlancamento=$2
             WHERE competencia=$1 AND status <> 'fechado'",
        )
        .bind(competencia)
        .bind(idlanc)
        .execute(&mut *tx)
        .await
        .map_err(map_db_err)?;
        tx.commit().await.map_err(map_db_err)?;
        Ok(idlanc)
    }

    async fn enxoval_mov(&self, limite: i64) -> Result<Vec<EnxovalMov>, DomainError> {
        sqlx::query_as::<_, EnxovalMov>(
            "SELECT id,tipo_item,quantidade,origem,destino,idlote,idquarto,data,registrado_por
             FROM enxoval_mov ORDER BY data DESC LIMIT $1",
        )
        .bind(limite)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn enxoval_registrar(&self, m: &NovoMovEnxoval) -> Result<(), DomainError> {
        sqlx::query(
            "INSERT INTO enxoval_mov (tipo_item,quantidade,origem,destino,idlote,idquarto,registrado_por)
             VALUES ($1,$2,$3,$4,$5,$6,$7)",
        )
        .bind(&m.tipo_item)
        .bind(m.quantidade)
        .bind(&m.origem)
        .bind(&m.destino)
        .bind(m.idlote)
        .bind(m.idquarto)
        .bind(m.registrado_por)
        .execute(&self.pool)
        .await
        .map_err(map_db_err)?;
        Ok(())
    }

    async fn enxoval_saldo(&self) -> Result<Vec<(String, i64)>, DomainError> {
        sqlx::query_as::<_, (String, i64)>(
            "SELECT tipo_item,
                SUM(CASE WHEN destino='estoque' THEN quantidade
                         WHEN origem='estoque' THEN -quantidade ELSE 0 END)::bigint AS saldo
             FROM enxoval_mov GROUP BY tipo_item ORDER BY tipo_item",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }
}

// ---------------------------------------------------------------------------
// escalas
// ---------------------------------------------------------------------------

pub struct PgEscalaRepository {
    pool: PgPool,
}

impl PgEscalaRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl EscalaRepository for PgEscalaRepository {
    async fn gravar_jornada(&self, j: &FuncionarioJornada) -> Result<(), DomainError> {
        sqlx::query(
            "INSERT INTO funcionario_jornada
                (idfuncionario,regime,entrada,saida,almoco_min,ancora,ativo)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (idfuncionario) DO UPDATE SET
                regime=$2,entrada=$3,saida=$4,almoco_min=$5,ancora=$6,ativo=$7",
        )
        .bind(j.idfuncionario)
        .bind(j.regime)
        .bind(j.entrada)
        .bind(j.saida)
        .bind(j.almoco_min)
        .bind(j.ancora)
        .bind(j.ativo)
        .execute(&self.pool)
        .await
        .map_err(map_db_err)?;
        Ok(())
    }

    async fn jornadas(&self) -> Result<Vec<FuncionarioJornada>, DomainError> {
        sqlx::query_as::<_, FuncionarioJornada>(
            "SELECT id,idfuncionario,regime,entrada,saida,almoco_min,ancora,ativo
             FROM funcionario_jornada ORDER BY idfuncionario",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn jornada_de(
        &self,
        idfuncionario: i64,
    ) -> Result<Option<FuncionarioJornada>, DomainError> {
        sqlx::query_as::<_, FuncionarioJornada>(
            "SELECT id,idfuncionario,regime,entrada,saida,almoco_min,ancora,ativo
             FROM funcionario_jornada WHERE idfuncionario=$1",
        )
        .bind(idfuncionario)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn turnos(
        &self,
        inicio: NaiveDate,
        fim: NaiveDate,
        idfuncionario: Option<i64>,
    ) -> Result<Vec<EscalaTurno>, DomainError> {
        match idfuncionario {
            Some(f) => sqlx::query_as::<_, EscalaTurno>(&format!(
                "SELECT {TURNO_COLS} FROM escala_turno
                 WHERE data BETWEEN $1 AND $2 AND idfuncionario=$3
                 ORDER BY data, inicio"
            ))
            .bind(inicio)
            .bind(fim)
            .bind(f)
            .fetch_all(&self.pool)
            .await
            .map_err(map_db_err),
            None => sqlx::query_as::<_, EscalaTurno>(&format!(
                "SELECT {TURNO_COLS} FROM escala_turno
                 WHERE data BETWEEN $1 AND $2 ORDER BY data, idfuncionario, inicio"
            ))
            .bind(inicio)
            .bind(fim)
            .fetch_all(&self.pool)
            .await
            .map_err(map_db_err),
        }
    }

    async fn gravar_turno(&self, t: &NovoTurno) -> Result<(), DomainError> {
        sqlx::query(
            "INSERT INTO escala_turno (idfuncionario,data,inicio,fim,almoco_min,origem)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (idfuncionario,data) DO UPDATE SET
                inicio=$3,fim=$4,almoco_min=$5,origem=$6",
        )
        .bind(t.idfuncionario)
        .bind(t.data)
        .bind(t.inicio)
        .bind(t.fim)
        .bind(t.almoco_min)
        .bind(t.origem)
        .execute(&self.pool)
        .await
        .map_err(map_db_err)?;
        Ok(())
    }

    async fn remover_turno(&self, id: i64) -> Result<(), DomainError> {
        sqlx::query("DELETE FROM escala_turno WHERE id=$1")
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(map_db_err)?;
        Ok(())
    }

    async fn nome_funcionario(&self, id: i64) -> Result<String, DomainError> {
        sqlx::query_scalar::<_, String>("SELECT nome FROM funcionario WHERE id=$1")
            .bind(id)
            .fetch_one(&self.pool)
            .await
            .map_err(map_db_err)
    }

    async fn com_jornada(&self) -> Result<Vec<i64>, DomainError> {
        sqlx::query_scalar(
            "SELECT j.idfuncionario FROM funcionario_jornada j
             JOIN funcionario f ON f.id=j.idfuncionario
             WHERE j.ativo AND f.ativo",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn turno_por_id(&self, id: i64) -> Result<Option<EscalaTurno>, DomainError> {
        sqlx::query_as::<_, EscalaTurno>(&format!(
            "SELECT {TURNO_COLS} FROM escala_turno WHERE id=$1"
        ))
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn ajustar_turno(
        &self,
        id: i64,
        inicio: DateTime<Utc>,
        fim: DateTime<Utc>,
        almoco_min: i16,
        origem: OrigemTurno,
    ) -> Result<EscalaTurno, DomainError> {
        sqlx::query_as::<_, EscalaTurno>(&format!(
            "UPDATE escala_turno SET inicio=$2,fim=$3,almoco_min=$4,origem=$5 WHERE id=$1 RETURNING {TURNO_COLS}"
        ))
        .bind(id)
        .bind(inicio)
        .bind(fim)
        .bind(almoco_min)
        .bind(origem)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)
    }
}
