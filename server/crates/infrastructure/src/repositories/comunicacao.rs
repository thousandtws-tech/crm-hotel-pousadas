//! Repositórios do módulo de comunicação — fila de envio, matriz,
//! supressão de e-mail, push, avaliações e fidelidade.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use clarituz_domain::entities::*;
use clarituz_domain::enums::{CanalEnvio, StatusAvaliacao};
use clarituz_domain::error::DomainError;
use clarituz_domain::ports::*;
use sqlx::PgPool;

use crate::db::map_db_err;

pub struct PgFilaEnvio {
    pool: PgPool,
}

impl PgFilaEnvio {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl FilaEnvioRepository for PgFilaEnvio {
    async fn enfileirar(&self, n: NovoEnvio) -> Result<i64, DomainError> {
        sqlx::query_scalar(
            "INSERT INTO fila_envio
                (canal, destino, template, payload, idreserva, idcliente,
                 idfuncionario, agendado_para)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
        )
        .bind(n.canal)
        .bind(&n.destino)
        .bind(&n.template)
        .bind(&n.payload)
        .bind(n.idreserva)
        .bind(n.idcliente)
        .bind(n.idfuncionario)
        .bind(n.agendado_para)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn proximos(
        &self,
        agora: DateTime<Utc>,
        limite: i64,
    ) -> Result<Vec<ItemFila>, DomainError> {
        // Claim atômico: réplicas concorrentes não pegam o mesmo item —
        // FOR UPDATE SKIP LOCKED marca como 'enviando' na mesma query.
        sqlx::query_as::<_, ItemFila>(
            "UPDATE fila_envio SET status='enviando'
             WHERE id IN (
                 SELECT id FROM fila_envio
                 WHERE status='pendente' AND agendado_para <= $1
                 ORDER BY agendado_para
                 LIMIT $2
                 FOR UPDATE SKIP LOCKED
             )
             RETURNING *",
        )
        .bind(agora)
        .bind(limite)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn marcar_enviado(
        &self,
        id: i64,
        provider_msg_id: Option<String>,
    ) -> Result<(), DomainError> {
        sqlx::query(
            "UPDATE fila_envio SET status='enviado', enviado_em=now(),
             provider_msg_id=$2, ultimo_erro=NULL WHERE id=$1",
        )
        .bind(id)
        .bind(provider_msg_id)
        .execute(&self.pool)
        .await
        .map_err(map_db_err)?;
        Ok(())
    }

    async fn marcar_falha(
        &self,
        id: i64,
        erro: &str,
        backoff_segundos: i64,
    ) -> Result<(), DomainError> {
        // Esq. exponencial na agenda; após 8 tentativas desiste de vez.
        sqlx::query(
            "UPDATE fila_envio SET
                tentativas = tentativas + 1,
                ultimo_erro = $2,
                agendado_para = now() + make_interval(secs => $3),
                status = CASE WHEN tentativas + 1 >= 8
                              THEN 'falhou'::status_envio
                              ELSE 'pendente'::status_envio END
             WHERE id=$1",
        )
        .bind(id)
        .bind(erro)
        .bind(backoff_segundos.max(30) as i32)
        .execute(&self.pool)
        .await
        .map_err(map_db_err)?;
        Ok(())
    }

    async fn cancelar(&self, id: i64) -> Result<(), DomainError> {
        sqlx::query("UPDATE fila_envio SET status='cancelado' WHERE id=$1")
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(map_db_err)?;
        Ok(())
    }

    async fn listar(&self, limite: i64) -> Result<Vec<ItemFila>, DomainError> {
        sqlx::query_as::<_, ItemFila>("SELECT * FROM fila_envio ORDER BY id DESC LIMIT $1")
            .bind(limite)
            .fetch_all(&self.pool)
            .await
            .map_err(map_db_err)
    }

    async fn email_suprimido(&self, email: &str) -> Result<bool, DomainError> {
        sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM email_supressao WHERE email = lower(trim($1)))",
        )
        .bind(email)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn suprimir_email(&self, email: &str, motivo: &str) -> Result<(), DomainError> {
        sqlx::query(
            "INSERT INTO email_supressao (email, motivo) VALUES (lower(trim($1)), $2)
             ON CONFLICT (email) DO NOTHING",
        )
        .bind(email)
        .bind(motivo)
        .execute(&self.pool)
        .await
        .map_err(map_db_err)?;
        Ok(())
    }

    async fn regras_do_evento(&self, evento: &str) -> Result<Vec<RegraMatriz>, DomainError> {
        sqlx::query_as::<_, RegraMatriz>(
            "SELECT evento, canal, papel, ativo FROM notificacao_matriz
             WHERE evento=$1 AND ativo",
        )
        .bind(evento)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn listar_matriz(&self) -> Result<Vec<RegraMatriz>, DomainError> {
        sqlx::query_as::<_, RegraMatriz>(
            "SELECT evento, canal, papel, ativo FROM notificacao_matriz
             ORDER BY evento, canal, papel",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn gravar_regra(&self, r: &RegraMatriz) -> Result<(), DomainError> {
        sqlx::query(
            "INSERT INTO notificacao_matriz (evento, canal, papel, ativo)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT (evento, canal, papel)
             DO UPDATE SET ativo = EXCLUDED.ativo",
        )
        .bind(&r.evento)
        .bind(r.canal)
        .bind(r.papel)
        .bind(r.ativo)
        .execute(&self.pool)
        .await
        .map_err(map_db_err)?;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// push
// ---------------------------------------------------------------------------

pub struct PgPushRepository {
    pool: PgPool,
}

impl PgPushRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl PushRepository for PgPushRepository {
    async fn gravar(&self, s: &PushSubscription) -> Result<(), DomainError> {
        sqlx::query(
            "INSERT INTO push_subscription (idfuncionario, endpoint, p256dh, auth, user_agent)
             VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (endpoint) DO UPDATE SET
                 idfuncionario=EXCLUDED.idfuncionario,
                 p256dh=EXCLUDED.p256dh, auth=EXCLUDED.auth,
                 user_agent=EXCLUDED.user_agent",
        )
        .bind(s.idfuncionario)
        .bind(&s.endpoint)
        .bind(&s.p256dh)
        .bind(&s.auth)
        .bind(&s.user_agent)
        .execute(&self.pool)
        .await
        .map_err(map_db_err)?;
        Ok(())
    }

    async fn remover(&self, endpoint: &str) -> Result<(), DomainError> {
        sqlx::query("DELETE FROM push_subscription WHERE endpoint=$1")
            .bind(endpoint)
            .execute(&self.pool)
            .await
            .map_err(map_db_err)?;
        Ok(())
    }

    async fn por_papel(&self, papel: i16) -> Result<Vec<PushSubscription>, DomainError> {
        sqlx::query_as::<_, PushSubscription>(
            "SELECT p.* FROM push_subscription p
             JOIN funcionario f ON f.id = p.idfuncionario
             WHERE f.nivel <= $1 AND f.ativo",
        )
        .bind(papel)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }
}

// ---------------------------------------------------------------------------
// avaliações
// ---------------------------------------------------------------------------

pub struct PgAvaliacaoRepository {
    pool: PgPool,
}

impl PgAvaliacaoRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl AvaliacaoRepository for PgAvaliacaoRepository {
    async fn criar(
        &self,
        idreserva: i64,
        idcliente: i64,
        plataforma: &str,
    ) -> Result<Avaliacao, DomainError> {
        sqlx::query_as::<_, Avaliacao>(
            "INSERT INTO avaliacao (idreserva, idcliente, plataforma)
             VALUES ($1,$2,$3) RETURNING *",
        )
        .bind(idreserva)
        .bind(idcliente)
        .bind(plataforma)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn por_token(&self, token: uuid::Uuid) -> Result<Avaliacao, DomainError> {
        sqlx::query_as::<_, Avaliacao>("SELECT * FROM avaliacao WHERE token=$1")
            .bind(token)
            .fetch_one(&self.pool)
            .await
            .map_err(map_db_err)
    }

    async fn por_reserva(&self, idreserva: i64) -> Result<Option<Avaliacao>, DomainError> {
        sqlx::query_as::<_, Avaliacao>(
            "SELECT * FROM avaliacao WHERE idreserva=$1 ORDER BY id DESC LIMIT 1",
        )
        .bind(idreserva)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn marcar_enviada(&self, id: i64) -> Result<(), DomainError> {
        sqlx::query("UPDATE avaliacao SET enviado_em=now() WHERE id=$1")
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(map_db_err)?;
        Ok(())
    }

    async fn marcar_lembrete(&self, id: i64) -> Result<(), DomainError> {
        sqlx::query("UPDATE avaliacao SET lembrete_em=now() WHERE id=$1")
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(map_db_err)?;
        Ok(())
    }

    async fn gravar_resposta_hospede(
        &self,
        id: i64,
        r: &RespostaAvaliacao,
    ) -> Result<(), DomainError> {
        let n = sqlx::query(
            "UPDATE avaliacao SET
                nota_geral=$2, nota_limpeza=$3, nota_atendimento=$4,
                nota_custo=$5, nota_localizacao=$6, nps=$7, comentario=$8,
                status='respondida'
             WHERE id=$1 AND status='pendente'",
        )
        .bind(id)
        .bind(r.nota_geral)
        .bind(r.nota_limpeza)
        .bind(r.nota_atendimento)
        .bind(r.nota_custo)
        .bind(r.nota_localizacao)
        .bind(r.nps)
        .bind(&r.comentario)
        .execute(&self.pool)
        .await
        .map_err(map_db_err)?
        .rows_affected();
        if n == 0 {
            return Err(DomainError::RegraNegocio(
                "avaliação já respondida ou expirada".into(),
            ));
        }
        Ok(())
    }

    async fn responder(
        &self,
        id: i64,
        resposta: &str,
        idfuncionario: i64,
    ) -> Result<(), DomainError> {
        sqlx::query(
            "UPDATE avaliacao SET resposta=$2, respondida_por=$3, respondida_em=now()
             WHERE id=$1",
        )
        .bind(id)
        .bind(resposta)
        .bind(idfuncionario)
        .execute(&self.pool)
        .await
        .map_err(map_db_err)?;
        Ok(())
    }

    async fn listar(
        &self,
        status: Option<StatusAvaliacao>,
        limite: i64,
    ) -> Result<Vec<Avaliacao>, DomainError> {
        if let Some(st) = status {
            sqlx::query_as::<_, Avaliacao>(
                "SELECT * FROM avaliacao WHERE status=$1 ORDER BY id DESC LIMIT $2",
            )
            .bind(st)
            .bind(limite)
            .fetch_all(&self.pool)
            .await
            .map_err(map_db_err)
        } else {
            sqlx::query_as::<_, Avaliacao>("SELECT * FROM avaliacao ORDER BY id DESC LIMIT $1")
                .bind(limite)
                .fetch_all(&self.pool)
                .await
                .map_err(map_db_err)
        }
    }

    async fn pendentes_lembrete(&self, ate: DateTime<Utc>) -> Result<Vec<Avaliacao>, DomainError> {
        sqlx::query_as::<_, Avaliacao>(
            "SELECT * FROM avaliacao
             WHERE status='pendente' AND enviado_em IS NOT NULL
               AND lembrete_em IS NULL AND enviado_em <= $1",
        )
        .bind(ate)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn pendentes_expirar(&self, ate: DateTime<Utc>) -> Result<Vec<Avaliacao>, DomainError> {
        sqlx::query_as::<_, Avaliacao>(
            "SELECT * FROM avaliacao
             WHERE status='pendente' AND criado_em <= $1",
        )
        .bind(ate)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn expirar(&self, id: i64) -> Result<(), DomainError> {
        sqlx::query("UPDATE avaliacao SET status='expirada' WHERE id=$1 AND status='pendente'")
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(map_db_err)?;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// fidelidade
// ---------------------------------------------------------------------------

pub struct PgFidelidadeRepository {
    pool: PgPool,
}

impl PgFidelidadeRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl FidelidadeRepository for PgFidelidadeRepository {
    async fn niveis(&self) -> Result<Vec<NivelFidelidade>, DomainError> {
        sqlx::query_as::<_, NivelFidelidade>("SELECT * FROM fidelidade_nivel ORDER BY ordem")
            .fetch_all(&self.pool)
            .await
            .map_err(map_db_err)
    }

    async fn gravar_nivel(&self, n: &NivelFidelidade) -> Result<i64, DomainError> {
        sqlx::query_scalar(
            "INSERT INTO fidelidade_nivel (nome, min_diarias, desconto_pct, beneficios, ordem, ativo)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (nome) DO UPDATE SET
                 min_diarias=EXCLUDED.min_diarias,
                 desconto_pct=EXCLUDED.desconto_pct,
                 beneficios=EXCLUDED.beneficios,
                 ordem=EXCLUDED.ordem,
                 ativo=EXCLUDED.ativo
             RETURNING id",
        )
        .bind(&n.nome)
        .bind(n.min_diarias)
        .bind(n.desconto_pct)
        .bind(&n.beneficios)
        .bind(n.ordem)
        .bind(n.ativo)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn remover_nivel(&self, id: i64) -> Result<(), DomainError> {
        sqlx::query("UPDATE fidelidade_nivel SET ativo=false WHERE id=$1")
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(map_db_err)?;
        Ok(())
    }

    async fn do_cliente(&self, idcliente: i64) -> Result<Option<FidelidadeCliente>, DomainError> {
        sqlx::query_as::<_, FidelidadeCliente>(
            "SELECT cf.idcliente, cf.diarias, cf.gasto_total, cf.idnivel, n.nome AS nivel_nome
             FROM cliente_fidelidade cf
             LEFT JOIN fidelidade_nivel n ON n.id = cf.idnivel
             WHERE cf.idcliente=$1",
        )
        .bind(idcliente)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn recomputar(&self, idcliente: i64) -> Result<(), DomainError> {
        // Uma passada: diárias + gasto vêm das reservas/consumo reais;
        // nível = maior min_diarias atingido.
        sqlx::query(
            "INSERT INTO cliente_fidelidade (idcliente, diarias, gasto_total, idnivel)
             SELECT c.id,
                    COALESCE(SUM(r.saidaprevista - r.entradaprevista), 0)::int,
                    COALESCE((
                        SELECT SUM(ci.total_centavos) FROM (
                            SELECT (co.preco * co.qtd * 100)::bigint AS total_centavos
                            FROM consumo co
                            JOIN reserva r2 ON r2.id = co.idreserva
                            WHERE r2.idcliente = c.id AND co.status = 'fechado'
                        ) ci), 0),
                    (SELECT n.id FROM fidelidade_nivel n
                      WHERE n.ativo
                        AND n.min_diarias <= COALESCE(SUM(r.saidaprevista - r.entradaprevista),0)
                      ORDER BY n.min_diarias DESC LIMIT 1)
             FROM cliente c
             LEFT JOIN reserva r ON r.idcliente = c.id
                AND r.status IN ('iniciada','finalizada')
             WHERE c.id = $1
             GROUP BY c.id
             ON CONFLICT (idcliente) DO UPDATE SET
                 diarias = EXCLUDED.diarias,
                 gasto_total = EXCLUDED.gasto_total,
                 idnivel = EXCLUDED.idnivel,
                 atualizado_em = now()",
        )
        .bind(idcliente)
        .execute(&self.pool)
        .await
        .map_err(map_db_err)?;
        Ok(())
    }

    async fn kpis_cliente(&self, idcliente: i64) -> Result<serde_json::Value, DomainError> {
        sqlx::query_scalar::<_, serde_json::Value>(
            "SELECT jsonb_build_object(
                 'estadias', COUNT(*) FILTER (WHERE r.status IN ('iniciada','finalizada')),
                 'diarias',  COALESCE(SUM(r.saidaprevista - r.entradaprevista)
                              FILTER (WHERE r.status IN ('iniciada','finalizada')),0),
                 'ltv_centavos', COALESCE(SUM(r.valor_total * 100)::bigint
                              FILTER (WHERE r.status IN ('iniciada','finalizada')),0),
                 'ticket_medio_centavos', COALESCE(AVG(r.valor_total * 100)::bigint
                              FILTER (WHERE r.status IN ('iniciada','finalizada')),0),
                 'ultima_estadia', MAX(r.saidaprevista)
                              FILTER (WHERE r.status IN ('iniciada','finalizada'))
             ) FROM reserva r WHERE r.idcliente=$1",
        )
        .bind(idcliente)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)
    }
}

// ---------------------------------------------------------------------------
// automações — consultas de reserva para os crons
// ---------------------------------------------------------------------------

pub struct PgAutomacaoRepository {
    pool: PgPool,
}

impl PgAutomacaoRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

const AUTO_COLS: &str = "r.id AS idreserva, r.idcliente, c.nome AS cliente_nome,
     c.email AS cliente_email, c.telefone AS cliente_telefone,
     r.entradaprevista, r.saidaprevista,
     a.nome AS acomodacao_nome, r.token_publico";

const AUTO_FROM: &str = "FROM reserva r
     JOIN cliente c ON c.id = r.idcliente
     LEFT JOIN acomodacao a ON a.id = r.idacomodacao";

#[async_trait]
impl AutomacaoRepository for PgAutomacaoRepository {
    async fn checkins_sem_fnrh(
        &self,
        data: chrono::NaiveDate,
    ) -> Result<Vec<ReservaAuto>, DomainError> {
        sqlx::query_as::<_, ReservaAuto>(&format!(
            "SELECT {AUTO_COLS} {AUTO_FROM}
             WHERE r.entradaprevista = $1
               AND r.status IN ('pendente','iniciada')
               AND r.fnrh_preenchida_em IS NULL"
        ))
        .bind(data)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn checkouts_do_dia(
        &self,
        data: chrono::NaiveDate,
    ) -> Result<Vec<ReservaAuto>, DomainError> {
        sqlx::query_as::<_, ReservaAuto>(&format!(
            "SELECT {AUTO_COLS} {AUTO_FROM}
             WHERE r.saidaprevista = $1 AND r.status = 'iniciada'"
        ))
        .bind(data)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn finalizadas_sem_avaliacao(
        &self,
        desde: DateTime<Utc>,
    ) -> Result<Vec<ReservaAuto>, DomainError> {
        sqlx::query_as::<_, ReservaAuto>(&format!(
            "SELECT {AUTO_COLS} {AUTO_FROM}
             WHERE r.status = 'finalizada' AND r.atualizado_em >= $1
               AND NOT EXISTS (SELECT 1 FROM avaliacao av WHERE av.idreserva = r.id)"
        ))
        .bind(desde)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn existe_envio(
        &self,
        idreserva: i64,
        template: &str,
        canal: CanalEnvio,
    ) -> Result<bool, DomainError> {
        sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM fila_envio
             WHERE idreserva=$1 AND template=$2 AND canal=$3
               AND status != 'cancelado')",
        )
        .bind(idreserva)
        .bind(template)
        .bind(canal)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn reserva_por_id(&self, idreserva: i64) -> Result<Option<ReservaAuto>, DomainError> {
        sqlx::query_as::<_, ReservaAuto>(&format!("SELECT {AUTO_COLS} {AUTO_FROM} WHERE r.id = $1"))
            .bind(idreserva)
            .fetch_optional(&self.pool)
            .await
            .map_err(map_db_err)
    }

    async fn reserva_publica_por_token(
        &self,
        token: uuid::Uuid,
    ) -> Result<Option<ReservaAuto>, DomainError> {
        sqlx::query_as::<_, ReservaAuto>(&format!(
            "SELECT {AUTO_COLS} {AUTO_FROM} WHERE r.token_publico = $1"
        ))
        .bind(token)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn gravar_pre_ficha(
        &self,
        idreserva: i64,
        dados: &serde_json::Value,
    ) -> Result<(), DomainError> {
        let n = sqlx::query(
            "UPDATE reserva SET fnrh_hospede=$2, fnrh_preenchida_em=now()
             WHERE id=$1 AND fnrh_preenchida_em IS NULL",
        )
        .bind(idreserva)
        .bind(dados)
        .execute(&self.pool)
        .await
        .map_err(map_db_err)?
        .rows_affected();
        if n == 0 {
            return Err(DomainError::regra("pré-ficha já preenchida"));
        }
        Ok(())
    }
}
