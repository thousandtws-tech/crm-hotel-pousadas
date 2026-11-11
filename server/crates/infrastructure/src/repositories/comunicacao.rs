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
                            WHERE r2.idcliente = c.id AND co.status = 'concluido'
                        ) ci), 0),
                    (SELECT n.id FROM fidelidade_nivel n
                      WHERE n.ativo
                        AND n.min_diarias <= COALESCE(SUM(r.saidaprevista - r.entradaprevista),0)
                      ORDER BY n.min_diarias DESC LIMIT 1)
             FROM cliente c
             LEFT JOIN reserva r ON r.idcliente = c.id
                AND r.status IN ('i','f')
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
                 'estadias', COUNT(*) FILTER (WHERE r.status IN ('i','f')),
                 'diarias',  COALESCE(SUM(r.saidaprevista - r.entradaprevista)
                              FILTER (WHERE r.status IN ('i','f')),0),
                 'ltv_centavos', COALESCE(SUM(r.valor_total * 100)::bigint
                              FILTER (WHERE r.status IN ('i','f')),0),
                 'ticket_medio_centavos', COALESCE(AVG(r.valor_total * 100)::bigint
                              FILTER (WHERE r.status IN ('i','f')),0),
                 'ultima_estadia', MAX(r.saidaprevista)
                              FILTER (WHERE r.status IN ('i','f'))
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
               AND r.status IN ('p','i')
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
             WHERE r.saidaprevista = $1 AND r.status = 'i'"
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
             WHERE r.status = 'f' AND r.atualizado_em >= $1
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

    async fn reserva_por_telefone(&self, finais: &str) -> Result<Option<ReservaAuto>, DomainError> {
        // Compara só dígitos: o `from` da Meta chega "5581..." e o cadastro
        // pode estar "(81) 9...". Sufixo de 8+ dígitos cobre o 9º dígito.
        sqlx::query_as::<_, ReservaAuto>(&format!(
            "SELECT {AUTO_COLS} {AUTO_FROM}
             WHERE r.status IN ('p','i')
               AND right(regexp_replace(coalesce(c.telefone, ''), '\\\\D', '', 'g'), 8)
                   = right($1, 8)
             ORDER BY CASE WHEN r.status = 'i' THEN 0 ELSE 1 END,
                      abs(r.entradaprevista - CURRENT_DATE)
             LIMIT 1"
        ))
        .bind(finais)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)
    }
}

// ---------------------------------------------------------------------------
// LGPD — opt-out, consentimento, solicitações do titular e anonimização.
// ---------------------------------------------------------------------------

pub struct PgLgpdRepository {
    pool: PgPool,
}

impl PgLgpdRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl LgpdRepository for PgLgpdRepository {
    async fn opt_out_telefone(
        &self,
        telefone_digitos: &str,
        canal: &str,
    ) -> Result<u64, DomainError> {
        let r = sqlx::query(
            "UPDATE cliente SET lgpd_opt_out = true, lgpd_opt_out_em = now(),
                    lgpd_opt_out_canal = $2, atualizado_em = now()
             WHERE right(regexp_replace(coalesce(telefone, ''), '\\\\D', '', 'g'), 8)
                   = right($1, 8)",
        )
        .bind(telefone_digitos)
        .bind(canal)
        .execute(&self.pool)
        .await
        .map_err(map_db_err)?;
        Ok(r.rows_affected())
    }

    async fn opt_out_cliente(&self, idcliente: i64, canal: &str) -> Result<(), DomainError> {
        sqlx::query(
            "UPDATE cliente SET lgpd_opt_out = true, lgpd_opt_out_em = now(),
                    lgpd_opt_out_canal = $2, atualizado_em = now()
             WHERE id = $1",
        )
        .bind(idcliente)
        .bind(canal)
        .execute(&self.pool)
        .await
        .map_err(map_db_err)?;
        Ok(())
    }

    async fn cliente_opt_out(&self, idcliente: i64) -> Result<bool, DomainError> {
        sqlx::query_scalar::<_, bool>(
            "SELECT coalesce(lgpd_opt_out, false) FROM cliente WHERE id = $1",
        )
        .bind(idcliente)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn registrar_consent(&self, idcliente: i64) -> Result<(), DomainError> {
        sqlx::query(
            "UPDATE cliente SET consent_marketing = true, consent_em = now(),
                    atualizado_em = now()
             WHERE id = $1",
        )
        .bind(idcliente)
        .execute(&self.pool)
        .await
        .map_err(map_db_err)?;
        Ok(())
    }

    async fn marcar_termos(&self, idreserva: i64, ip: &str) -> Result<(), DomainError> {
        sqlx::query(
            "UPDATE reserva SET termos_aceitos_em = coalesce(termos_aceitos_em, now()),
                    termos_aceitos_ip = coalesce(termos_aceitos_ip, $2)
             WHERE id = $1",
        )
        .bind(idreserva)
        .bind(ip)
        .execute(&self.pool)
        .await
        .map_err(map_db_err)?;
        Ok(())
    }

    async fn marcar_autorizacao_menor(&self, idreserva: i64, doc: &str) -> Result<(), DomainError> {
        sqlx::query("UPDATE reserva SET autorizacao_menor = $2 WHERE id = $1")
            .bind(idreserva)
            .bind(doc)
            .execute(&self.pool)
            .await
            .map_err(map_db_err)?;
        Ok(())
    }

    async fn autorizacao_menor(&self, idreserva: i64) -> Result<Option<String>, DomainError> {
        sqlx::query_scalar::<_, Option<String>>(
            "SELECT autorizacao_menor FROM reserva WHERE id = $1",
        )
        .bind(idreserva)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn exportar_cliente(&self, idcliente: i64) -> Result<serde_json::Value, DomainError> {
        // Todos os dados pessoais — cliente + reservas + FNRH + avaliações.
        sqlx::query_scalar::<_, serde_json::Value>(
            "SELECT jsonb_build_object(
                'cliente', (SELECT to_jsonb(c) FROM cliente c WHERE c.id = $1),
                'reservas', (SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]')
                             FROM reserva r WHERE r.idcliente = $1),
                'fnrh', (SELECT coalesce(jsonb_agg(to_jsonb(f)), '[]')
                         FROM fnrh f WHERE f.idcliente = $1),
                'avaliacoes', (SELECT coalesce(jsonb_agg(to_jsonb(a)), '[]')
                               FROM avaliacao a WHERE a.idcliente = $1),
                'solicitacoes', (SELECT coalesce(jsonb_agg(to_jsonb(s)), '[]')
                                 FROM lgpd_solicitacao s WHERE s.idcliente = $1),
                'exportado_em', now()
            )",
        )
        .bind(idcliente)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn anonimizar_cliente(&self, idcliente: i64) -> Result<(), DomainError> {
        // Art. 16 LGPD — trilha fiscal/FNRH (obrigação legal) é preservada;
        // o que some é a identificação pessoal do titular. cpf/data_nascimento
        // são NOT NULL → placeholders determinísticos.
        sqlx::query(
            "UPDATE cliente SET
                nome = 'Titular anonimizado', email = NULL, telefone = NULL,
                cpf = 'LGPD-' || id, data_nascimento = '1900-01-01',
                nacionalidade = NULL, naturalidade = NULL, profissao = NULL,
                logradouro = NULL, numero = NULL, complemento = NULL,
                bairro = NULL, cidade = NULL, estado = NULL, cep = NULL,
                pais = NULL, foto = NULL, preferencias = '{}',
                observacoes = NULL, anonimizado_em = now(), atualizado_em = now()
             WHERE id = $1 AND anonimizado_em IS NULL",
        )
        .bind(idcliente)
        .execute(&self.pool)
        .await
        .map_err(map_db_err)?;
        sqlx::query("DELETE FROM cliente_documento WHERE idcliente = $1")
            .bind(idcliente)
            .execute(&self.pool)
            .await
            .map_err(map_db_err)?;
        Ok(())
    }

    async fn anonimizar_vencidos(&self, anos: i32) -> Result<u64, DomainError> {
        let ids = sqlx::query_scalar::<_, i64>(
            "SELECT id FROM cliente WHERE anonimizado_em IS NULL
               AND NOT EXISTS (
                   SELECT 1 FROM reserva r
                   WHERE r.idcliente = cliente.id
                     AND r.saidaprevista > CURRENT_DATE - make_interval(years => $1))",
        )
        .bind(anos)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)?;
        for id in &ids {
            self.anonimizar_cliente(*id).await?;
        }
        Ok(ids.len() as u64)
    }

    async fn criar_solicitacao(
        &self,
        idcliente: Option<i64>,
        idreserva: Option<i64>,
        tipo: &str,
        detalhe: Option<&str>,
        canal: &str,
    ) -> Result<i64, DomainError> {
        sqlx::query_scalar::<_, i64>(
            "INSERT INTO lgpd_solicitacao (idcliente, idreserva, tipo, detalhe, canal)
             VALUES ($1, $2, $3, $4, $5) RETURNING id",
        )
        .bind(idcliente)
        .bind(idreserva)
        .bind(tipo)
        .bind(detalhe)
        .bind(canal)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn listar_solicitacoes(
        &self,
        status: Option<&str>,
    ) -> Result<Vec<LgpdSolicitacao>, DomainError> {
        sqlx::query_as::<_, LgpdSolicitacao>(
            "SELECT * FROM lgpd_solicitacao
             WHERE ($1::text IS NULL OR status = $1)
             ORDER BY criado_em DESC LIMIT 200",
        )
        .bind(status)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn responder_solicitacao(
        &self,
        id: i64,
        resposta: &str,
        idfuncionario: i64,
    ) -> Result<(), DomainError> {
        sqlx::query(
            "UPDATE lgpd_solicitacao SET status = 'respondida', resposta = $2,
                    respondida_em = now(), respondida_por = $3, atualizado_em = now()
             WHERE id = $1",
        )
        .bind(id)
        .bind(resposta)
        .bind(idfuncionario)
        .execute(&self.pool)
        .await
        .map_err(map_db_err)?;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Inná — histórico de conversa hóspede↔IA (portal + WhatsApp)
// ---------------------------------------------------------------------------

pub struct PgInnaRepository {
    pool: PgPool,
}

impl PgInnaRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl InnaRepository for PgInnaRepository {
    async fn gravar_mensagem(
        &self,
        idreserva: i64,
        canal: &str,
        origem: &str,
        texto: &str,
        provider_id: Option<&str>,
    ) -> Result<Option<i64>, DomainError> {
        // ON CONFLICT no provider_id → webhook Meta reentrega a mesma
        // mensagem; devolve None e o chamador ignora (dedup inbound).
        sqlx::query_scalar::<_, i64>(
            "INSERT INTO inna_mensagem (idreserva, canal, origem, texto, provider_id)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (provider_id) WHERE provider_id IS NOT NULL DO NOTHING
             RETURNING id",
        )
        .bind(idreserva)
        .bind(canal)
        .bind(origem)
        .bind(texto)
        .bind(provider_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn historico(
        &self,
        idreserva: i64,
        limite: i64,
    ) -> Result<Vec<InnaMensagem>, DomainError> {
        sqlx::query_as::<_, InnaMensagem>(
            "SELECT id, idreserva, canal, origem, texto, criado_em
             FROM (SELECT * FROM inna_mensagem
                   WHERE idreserva = $1
                   ORDER BY criado_em DESC LIMIT $2) t
             ORDER BY t.criado_em",
        )
        .bind(idreserva)
        .bind(limite)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }
}

// ---------------------------------------------------------------------------
// Pré-reserva via WhatsApp — máquina de estados por telefone.
// ---------------------------------------------------------------------------

pub struct PgPreReservaRepository {
    pool: PgPool,
}

impl PgPreReservaRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl PreReservaRepository for PgPreReservaRepository {
    async fn pre_reserva_obter(&self, telefone: &str) -> Result<Option<PreReserva>, DomainError> {
        sqlx::query_as::<_, PreReserva>(
            "SELECT telefone, etapa, dados, expira_em FROM pre_reserva
             WHERE telefone = $1 AND expira_em > now()",
        )
        .bind(telefone)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn pre_reserva_salvar(
        &self,
        telefone: &str,
        etapa: &str,
        dados: &serde_json::Value,
        expira_em: DateTime<Utc>,
    ) -> Result<(), DomainError> {
        sqlx::query(
            "INSERT INTO pre_reserva (telefone, etapa, dados, expira_em)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (telefone) DO UPDATE
             SET etapa = $2, dados = $3, expira_em = $4",
        )
        .bind(telefone)
        .bind(etapa)
        .bind(dados)
        .bind(expira_em)
        .execute(&self.pool)
        .await
        .map_err(map_db_err)?;
        Ok(())
    }

    async fn pre_reserva_remover(&self, telefone: &str) -> Result<(), DomainError> {
        sqlx::query("DELETE FROM pre_reserva WHERE telefone = $1")
            .bind(telefone)
            .execute(&self.pool)
            .await
            .map_err(map_db_err)?;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Atendimento — protocolos por setor com SLA.
// ---------------------------------------------------------------------------

const ATEND_COLS: &str = "id, protocolo, origem, setor, prioridade, status, telefone,
    idreserva, idcliente, assunto, ultima_msg, motivo, idfuncionario,
    prazo_aceite, criado_em, atribuido_em, escalado_em, resolvido_em";

pub struct PgAtendimentoRepository {
    pool: PgPool,
}

impl PgAtendimentoRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl AtendimentoRepository for PgAtendimentoRepository {
    async fn atendimento_abrir(&self, a: &NovoAtendimento) -> Result<Atendimento, DomainError> {
        // Protocolo falável derivado do id em duas queries na mesma tx:
        // INSERT com placeholder → UPDATE 'A-NNNNNN'. Sem race (id é
        // sequencial único) e sem precisar de sequence extra.
        let mut tx = self.pool.begin().await.map_err(map_db_err)?;
        let id: i64 = sqlx::query_scalar(
            "INSERT INTO atendimento
             (protocolo, origem, setor, prioridade, status, telefone,
              idreserva, idcliente, assunto, ultima_msg, motivo, prazo_aceite)
             VALUES ('-', $1, $2, $3, 'aberto', $4, $5, $6, $7, $8, $9, $10)
             RETURNING id",
        )
        .bind(&a.origem)
        .bind(&a.setor)
        .bind(&a.prioridade)
        .bind(&a.telefone)
        .bind(a.idreserva)
        .bind(a.idcliente)
        .bind(&a.assunto)
        .bind(&a.ultima_msg)
        .bind(&a.motivo)
        .bind(a.prazo_aceite)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_db_err)?;
        sqlx::query(
            "UPDATE atendimento SET protocolo = 'A-' || lpad(id::text, 6, '0') WHERE id = $1",
        )
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(map_db_err)?;
        tx.commit().await.map_err(map_db_err)?;
        sqlx::query_as::<_, Atendimento>(&format!(
            "SELECT {ATEND_COLS} FROM atendimento WHERE id = $1"
        ))
        .bind(id)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn atendimento_fila(
        &self,
        status: &str,
        setor: Option<&str>,
    ) -> Result<Vec<Atendimento>, DomainError> {
        sqlx::query_as::<_, Atendimento>(&format!(
            "SELECT {ATEND_COLS} FROM atendimento
             WHERE status = $1 AND ($2::text IS NULL OR setor = $2)
             ORDER BY prioridade DESC, criado_em"
        ))
        .bind(status)
        .bind(setor)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn atendimento_aceitar(
        &self,
        id: i64,
        idfuncionario: i64,
    ) -> Result<Atendimento, DomainError> {
        sqlx::query_as::<_, Atendimento>(&format!(
            "UPDATE atendimento SET status = 'em_atendimento',
             idfuncionario = $2, atribuido_em = now()
             WHERE id = $1 AND status IN ('aberto','escalado')
             RETURNING {ATEND_COLS}"
        ))
        .bind(id)
        .bind(idfuncionario)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn atendimento_resolver(
        &self,
        id: i64,
        idfuncionario: i64,
    ) -> Result<Atendimento, DomainError> {
        sqlx::query_as::<_, Atendimento>(&format!(
            "UPDATE atendimento SET status = 'resolvido',
             idfuncionario = $2, resolvido_em = now()
             WHERE id = $1 AND status <> 'resolvido'
             RETURNING {ATEND_COLS}"
        ))
        .bind(id)
        .bind(idfuncionario)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn atendimento_vencidos(&self) -> Result<Vec<Atendimento>, DomainError> {
        sqlx::query_as::<_, Atendimento>(&format!(
            "SELECT {ATEND_COLS} FROM atendimento
             WHERE status = 'aberto' AND prazo_aceite < now()"
        ))
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn atendimento_escalar(&self, id: i64) -> Result<Atendimento, DomainError> {
        sqlx::query_as::<_, Atendimento>(&format!(
            "UPDATE atendimento SET status = 'escalado', escalado_em = now()
             WHERE id = $1 AND status = 'aberto'
             RETURNING {ATEND_COLS}"
        ))
        .bind(id)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)
    }
}
