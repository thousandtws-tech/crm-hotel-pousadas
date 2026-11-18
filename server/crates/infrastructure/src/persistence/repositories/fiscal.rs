//! Repositório fiscal — documentos (outbox durável) e eventos de webhook.
//!
//! `reivindicar_fila` usa `FOR UPDATE SKIP LOCKED`: seguro para N réplicas
//! do worker sem duplicar transmissões.

use crate::persistence::db::map_db_err;
use async_trait::async_trait;
use clarituz_domain::entities::{FiscalDocumento, FiscalEvento, StatusFiscal};
use clarituz_domain::ports::{
    FiltroDocumentos, FiscalEventoRegistro, FiscalRepository, NovoDocumentoFiscal,
};
use clarituz_domain::DomainError;
use sqlx::PgPool;
use std::fmt::Write as _;

const COLS: &str = "id, idintegracao, idreserva, modelo, integration_id, remote_id,
    status, status_remoto, processing_detail, tomador, payload, valor_total,
    descricao, competencia, motivo_cancelamento, numero_nota, url_consulta,
    ultimo_erro, tentativas, proxima_tentativa, criado_por, atualizado_por,
    transmitido_em, autorizado_em, cancelado_em, criado_em, atualizado_em";

pub struct PgFiscalRepository {
    pool: PgPool,
}

impl PgFiscalRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl FiscalRepository for PgFiscalRepository {
    async fn criar(&self, n: &NovoDocumentoFiscal) -> Result<FiscalDocumento, DomainError> {
        sqlx::query_as::<_, FiscalDocumento>(&format!(
            "INSERT INTO fiscal_documento
                (idintegracao, idreserva, modelo, integration_id, tomador, payload,
                 valor_total, descricao, competencia, criado_por, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'rascunho')
             RETURNING {COLS}"
        ))
        .bind(n.idintegracao)
        .bind(n.idreserva)
        .bind(&n.modelo)
        .bind(&n.integration_id)
        .bind(&n.tomador)
        .bind(&n.payload)
        .bind(n.valor_total)
        .bind(&n.descricao)
        .bind(n.competencia)
        .bind(n.criado_por)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| match map_db_err(e) {
            DomainError::RegraNegocio(m) if m.contains("uq_fiscal_doc_integration") => {
                DomainError::conflito("Este documento já foi registrado — emissão não duplicada.")
            }
            e => e,
        })
    }

    async fn buscar(&self, id: i64) -> Result<Option<FiscalDocumento>, DomainError> {
        sqlx::query_as::<_, FiscalDocumento>(&format!(
            "SELECT {COLS} FROM fiscal_documento WHERE id = $1"
        ))
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn buscar_por_integration_id(
        &self,
        idintegracao: i64,
        integration_id: &str,
    ) -> Result<Option<FiscalDocumento>, DomainError> {
        sqlx::query_as::<_, FiscalDocumento>(&format!(
            "SELECT {COLS} FROM fiscal_documento
             WHERE idintegracao = $1 AND integration_id = $2"
        ))
        .bind(idintegracao)
        .bind(integration_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn buscar_por_remote_id(
        &self,
        remote_id: &str,
    ) -> Result<Option<FiscalDocumento>, DomainError> {
        sqlx::query_as::<_, FiscalDocumento>(&format!(
            "SELECT {COLS} FROM fiscal_documento WHERE remote_id = $1"
        ))
        .bind(remote_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn listar(
        &self,
        f: &FiltroDocumentos,
    ) -> Result<(Vec<FiscalDocumento>, i64), DomainError> {
        let mut where_ = String::from("WHERE TRUE");
        let mut i = 1;
        if f.idreserva.is_some() {
            i += 1;
            let _ = write!(where_, " AND idreserva = ${i}");
        }
        if f.status.is_some() {
            i += 1;
            let _ = write!(where_, " AND status = ${i}");
        }
        if f.de.is_some() {
            i += 1;
            let _ = write!(where_, " AND competencia >= ${i}");
        }
        if f.ate.is_some() {
            i += 1;
            let _ = write!(where_, " AND competencia <= ${i}");
        }
        if f.ambiente.is_some() {
            i += 1;
            let _ = write!(
                where_,
                " AND idintegracao IN (SELECT id FROM integracao WHERE ambiente = ${i})"
            );
        }
        let limite = f.por_pagina.clamp(1, 100);
        let offset = (f.pagina.max(1) - 1) * limite;
        i += 1;
        let lim_idx = i;
        i += 1;
        let off_idx = i;

        let q = format!(
            "SELECT {COLS} FROM fiscal_documento {where_}
             ORDER BY criado_em DESC LIMIT ${lim_idx} OFFSET ${off_idx}"
        );
        let mut query = sqlx::query_as::<_, FiscalDocumento>(&q);
        // Re-vincula na MESMA ordem em que os índices foram consumidos.
        if let Some(v) = f.idreserva {
            query = query.bind(v);
        }
        if let Some(v) = f.status {
            query = query.bind(v.as_str());
        }
        if let Some(v) = f.de {
            query = query.bind(v);
        }
        if let Some(v) = f.ate {
            query = query.bind(v);
        }
        if let Some(v) = f.ambiente {
            query = query.bind(v.as_str());
        }
        let docs = query
            .bind(limite)
            .bind(offset)
            .fetch_all(&self.pool)
            .await
            .map_err(map_db_err)?;

        // Count sem paginação — mesma filtragem, sem os binds de limite.
        let qcount = format!("SELECT count(*) FROM fiscal_documento {where_}");
        let mut qc = sqlx::query_scalar::<_, i64>(&qcount);
        if let Some(v) = f.idreserva {
            qc = qc.bind(v);
        }
        if let Some(v) = f.status {
            qc = qc.bind(v.as_str());
        }
        if let Some(v) = f.de {
            qc = qc.bind(v);
        }
        if let Some(v) = f.ate {
            qc = qc.bind(v);
        }
        if let Some(v) = f.ambiente {
            qc = qc.bind(v.as_str());
        }
        let _ = (lim_idx, off_idx);
        let total = qc.fetch_one(&self.pool).await.map_err(map_db_err)?;

        Ok((docs, total))
    }

    async fn listar_por_reserva(
        &self,
        idreserva: i64,
    ) -> Result<Vec<FiscalDocumento>, DomainError> {
        sqlx::query_as::<_, FiscalDocumento>(&format!(
            "SELECT {COLS} FROM fiscal_documento WHERE idreserva = $1
             ORDER BY criado_em DESC"
        ))
        .bind(idreserva)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn proxima_sequencia(&self, idintegracao: i64) -> Result<i64, DomainError> {
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) + 1 FROM fiscal_documento WHERE idintegracao = $1",
        )
        .bind(idintegracao)
        .fetch_one(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn registrar_transicao(
        &self,
        id: i64,
        status: StatusFiscal,
        status_remoto: Option<&str>,
        processing_detail: Option<&str>,
        remote_id: Option<&str>,
        numero_nota: Option<&str>,
        url_consulta: Option<&str>,
        erro: Option<&str>,
        atualizado_por: Option<i64>,
    ) -> Result<(), DomainError> {
        sqlx::query(
            "UPDATE fiscal_documento SET
                status = $2,
                status_remoto = COALESCE($3, status_remoto),
                processing_detail = COALESCE($4, processing_detail),
                remote_id = COALESCE($5, remote_id),
                numero_nota = COALESCE($6, numero_nota),
                url_consulta = COALESCE($7, url_consulta),
                ultimo_erro = $8,
                atualizado_por = COALESCE($9, atualizado_por),
                transmitido_em = CASE WHEN $2 = 'processando' AND transmitido_em IS NULL
                    THEN now() ELSE transmitido_em END,
                autorizado_em = CASE WHEN $2 = 'autorizada' THEN now() ELSE autorizado_em END,
                cancelado_em = CASE WHEN $2 = 'cancelada' THEN now() ELSE cancelado_em END,
                atualizado_em = now()
             WHERE id = $1",
        )
        .bind(id)
        .bind(status.as_str())
        .bind(status_remoto)
        .bind(processing_detail)
        .bind(remote_id)
        .bind(numero_nota)
        .bind(url_consulta)
        .bind(erro)
        .bind(atualizado_por)
        .execute(&self.pool)
        .await
        .map_err(map_db_err)?;
        Ok(())
    }

    async fn reivindicar_fila(&self, limite: i64) -> Result<Vec<FiscalDocumento>, DomainError> {
        sqlx::query_as::<_, FiscalDocumento>(&format!(
            "UPDATE fiscal_documento SET proxima_tentativa = now() + interval '5 minutes'
             WHERE id IN (
                SELECT id FROM fiscal_documento
                WHERE status = 'enfileirada'
                  AND (proxima_tentativa IS NULL OR proxima_tentativa <= now())
                ORDER BY criado_em
                LIMIT $1
                FOR UPDATE SKIP LOCKED
             )
             RETURNING {COLS}"
        ))
        .bind(limite)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn registrar_motivo_cancelamento(
        &self,
        id: i64,
        motivo: &str,
    ) -> Result<(), DomainError> {
        sqlx::query(
            "UPDATE fiscal_documento SET motivo_cancelamento = $2,
                atualizado_em = now() WHERE id = $1",
        )
        .bind(id)
        .bind(motivo)
        .execute(&self.pool)
        .await
        .map_err(map_db_err)?;
        Ok(())
    }

    async fn reagendar(
        &self,
        id: i64,
        tentativas: i32,
        proxima: chrono::DateTime<chrono::Utc>,
        erro: &str,
    ) -> Result<(), DomainError> {
        // Além do teto de retentativas, a fila para e o documento fica
        // 'falha' para ação manual (corrigir payload ≠ retry cego).
        sqlx::query(
            "UPDATE fiscal_documento SET
                tentativas = $2,
                proxima_tentativa = $3,
                ultimo_erro = $4,
                status = CASE WHEN $2 >= 5 THEN 'falha' ELSE status END,
                atualizado_em = now()
             WHERE id = $1",
        )
        .bind(id)
        .bind(tentativas)
        .bind(proxima)
        .bind(erro)
        .execute(&self.pool)
        .await
        .map_err(map_db_err)?;
        Ok(())
    }

    async fn falhas(
        &self,
        desde: chrono::DateTime<chrono::Utc>,
        limite: i64,
    ) -> Result<Vec<FiscalDocumento>, DomainError> {
        sqlx::query_as::<_, FiscalDocumento>(&format!(
            "SELECT {COLS} FROM fiscal_documento
             WHERE status IN ('rejeitada','falha') AND atualizado_em >= $1
             ORDER BY id LIMIT $2"
        ))
        .bind(desde)
        .bind(limite)
        .fetch_all(&self.pool)
        .await
        .map_err(map_db_err)
    }

    async fn registrar_evento(
        &self,
        idintegracao: Option<i64>,
        event_id: &str,
        tipo: &str,
        payload: &serde_json::Value,
        assinatura_ok: bool,
    ) -> Result<FiscalEventoRegistro, DomainError> {
        // Persiste ANTES de responder 2xx; UNIQUE faz a deduplicação —
        // duplicata conhecida recebe 2xx sem repetir efeitos.
        let row: Option<(i64,)> = sqlx::query_as(
            "INSERT INTO fiscal_evento (idintegracao, event_id, tipo, payload, assinatura_ok)
             VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (idintegracao, event_id) DO NOTHING
             RETURNING id",
        )
        .bind(idintegracao)
        .bind(event_id)
        .bind(tipo)
        .bind(payload)
        .bind(assinatura_ok)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)?;
        Ok(match row {
            Some((id,)) => FiscalEventoRegistro::Inserido(id),
            None => FiscalEventoRegistro::Duplicado,
        })
    }

    async fn marcar_evento(
        &self,
        id: i64,
        status: &str,
        erro: Option<&str>,
    ) -> Result<(), DomainError> {
        sqlx::query(
            "UPDATE fiscal_evento SET status = $2, ultimo_erro = $3,
                processado_em = CASE WHEN $2 = 'processado' THEN now() ELSE processado_em END
             WHERE id = $1",
        )
        .bind(id)
        .bind(status)
        .bind(erro)
        .execute(&self.pool)
        .await
        .map_err(map_db_err)?;
        Ok(())
    }

    async fn ultimo_evento(&self, idintegracao: i64) -> Result<Option<FiscalEvento>, DomainError> {
        sqlx::query_as::<_, FiscalEvento>(
            "SELECT id, idintegracao, event_id, tipo, payload, assinatura_ok,
                    status, ultimo_erro, recebido_em, processado_em
             FROM fiscal_evento
             WHERE idintegracao = $1
             ORDER BY recebido_em DESC LIMIT 1",
        )
        .bind(idintegracao)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_db_err)
    }
}
