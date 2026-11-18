//! Tarefas de fundo do processo `serve`, organizadas por bounded context.
//!
//! Cada worker é idempotente e seguro para rodar em todas as réplicas:
//! varreduras periódicas de conciliação de pagamentos, drenagem da fila
//! de envio, lembretes/pesquisas, escalada de SLA de atendimento,
//! governança D-1, retenção LGPD, alerta de PMOC, métricas de saturação
//! e o monitor de falhas operacionais (alerta no sino da equipe).

mod alertas;
mod atendimento;
mod comunicacao;
mod distribuicao;
mod fiscal;
mod metricas;
mod pagamentos;
mod rotinas;

use crate::http::state::AppState;

/// Agenda todos os workers periódicos sobre o estado já construído.
pub fn spawn_all(state: &AppState, stripe_ativo: bool) {
    if stripe_ativo {
        pagamentos::spawn(state);
    }
    alertas::spawn(state);
    comunicacao::spawn_fila(state);
    comunicacao::spawn_lembretes(state);
    comunicacao::spawn_zapi_eventos(state);
    comunicacao::spawn_infobip_eventos(state);
    fiscal::spawn(state);
    distribuicao::spawn(state);
    atendimento::spawn(state);
    rotinas::spawn(state);
    metricas::spawn(state.pool.clone(), state.eventos.clone());
}
