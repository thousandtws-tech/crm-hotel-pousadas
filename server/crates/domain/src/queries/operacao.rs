use serde::Serialize;
use sqlx::FromRow;

/// Card do mapa por andar — uma linha por acomodação física, com
/// ocupação (reserva), bloqueio formal e pendências de operação.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct MapaQuarto {
    pub id: i64,
    pub nome: String,
    pub numero: i32,
    pub andar: i32,
    pub cor: String,
    pub tipo: Option<String>,
    /// Reserva ativa cobrindo hoje (p=pendente, i=iniciada).
    pub idreserva_hoje: Option<i64>,
    pub status_hoje: Option<String>,
    pub bloqueado: bool,
    /// Tarefas de limpeza de hoje não concluídas nos quartos vinculados.
    pub limpeza_pendente: i64,
    /// Id da tarefa de limpeza pendente de hoje — permite "marcar limpa"
    /// direto no mapa (PATCH /governanca/tarefas/{id}/status).
    pub idtarefa_limpeza: Option<i64>,
    /// OS de manutenção abertas nos quartos vinculados.
    pub manut_aberta: i64,
}
