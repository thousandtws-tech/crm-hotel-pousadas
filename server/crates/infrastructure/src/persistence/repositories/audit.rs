//! Helper interno: gravação de trilha de auditoria dentro da transação ativa.

use clarituz_domain::entities::NovoLog;
use clarituz_domain::DomainError;

/// Insere uma entrada em `log`. Falhar o log **falha a operação** —
/// auditabilidade não é best-effort neste sistema.
pub async fn gravar<'e, E>(ex: E, log: &NovoLog) -> Result<(), DomainError>
where
    E: sqlx::PgExecutor<'e>,
{
    sqlx::query(
        r"INSERT INTO log (idfuncionario, acao, obs, tabela, idtabela, dados)
           VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(log.idfuncionario)
    .bind(&log.acao)
    .bind(&log.obs)
    .bind(log.tabela)
    .bind(log.idtabela)
    .bind(&log.dados)
    .execute(ex)
    .await
    .map_err(crate::persistence::db::map_db_err)?;
    Ok(())
}
