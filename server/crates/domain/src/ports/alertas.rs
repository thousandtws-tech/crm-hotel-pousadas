//! Porta do monitor de falhas operacionais — dedup durável dos alertas
//! já disparados. A chave é a identidade da ocorrência; a persistência
//! substitui watermark em memória (restart e réplicas não re-alertam).

use crate::error::DomainError;
use async_trait::async_trait;

/// Intenção de alerta operacional — `dedup_key` decide se a ocorrência
/// já foi alertada (uma vez por item por ocorrência).
#[derive(Debug, Clone)]
pub struct NovoAlerta {
    pub dedup_key: String,
    /// Origem do item monitorado — 'fila_envio' | 'fiscal_documento'.
    pub origem: String,
    pub id_origem: i64,
    pub titulo: String,
    pub mensagem: String,
}

#[async_trait]
pub trait AlertaOperacionalRepository: Send + Sync {
    /// Registra a intenção de alerta — `true` quando a `dedup_key` é
    /// nova (o alerta deve disparar); `false` quando a ocorrência já
    /// foi alertada antes (dedup, não repete).
    async fn registrar(&self, alerta: &NovoAlerta) -> Result<bool, DomainError>;
}
