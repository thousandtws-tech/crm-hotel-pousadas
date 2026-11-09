use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

use crate::enums::{CanalEnvio, StatusAvaliacao, StatusEnvio};

// ---------------------------------------------------------------------------
// fila de envio (outbox)
// ---------------------------------------------------------------------------

/// Item da outbox persistente — toda saída externa passa por aqui para
/// retry/backoff e rastreio. `destino` é opaco por canal (e-mail,
/// telefone E.164, hash do endpoint push).
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct ItemFila {
    pub id: i64,
    pub canal: CanalEnvio,
    pub destino: String,
    pub template: String,
    pub payload: serde_json::Value,
    pub idreserva: Option<i64>,
    pub idcliente: Option<i64>,
    pub idfuncionario: Option<i64>,
    pub agendado_para: DateTime<Utc>,
    pub tentativas: i16,
    pub ultimo_erro: Option<String>,
    pub provider_msg_id: Option<String>,
    pub status: StatusEnvio,
    pub criado_em: DateTime<Utc>,
    pub enviado_em: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone)]
pub struct NovoEnvio {
    pub canal: CanalEnvio,
    pub destino: String,
    pub template: String,
    pub payload: serde_json::Value,
    pub idreserva: Option<i64>,
    pub idcliente: Option<i64>,
    pub idfuncionario: Option<i64>,
    pub agendado_para: DateTime<Utc>,
}

// ---------------------------------------------------------------------------
// matriz de notificação (evento × canal × papel)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct RegraMatriz {
    pub evento: String,
    pub canal: CanalEnvio,
    /// Mesmo semântico de `notificacao.ate_nivel`: 1=admin, 2=gerente, 3=todos.
    pub papel: i16,
    pub ativo: bool,
}

// ---------------------------------------------------------------------------
// push (PWA admin — VAPID tickle)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct PushSubscription {
    pub id: i64,
    pub idfuncionario: i64,
    pub endpoint: String,
    pub p256dh: String,
    pub auth: String,
    pub user_agent: Option<String>,
}

// ---------------------------------------------------------------------------
// avaliações / reputação
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct Avaliacao {
    pub id: i64,
    pub idreserva: i64,
    pub idcliente: i64,
    pub token: uuid::Uuid,
    pub plataforma: String,
    pub nota_geral: Option<i16>,
    pub nota_limpeza: Option<i16>,
    pub nota_atendimento: Option<i16>,
    pub nota_custo: Option<i16>,
    pub nota_localizacao: Option<i16>,
    pub nps: Option<i16>,
    pub comentario: Option<String>,
    pub resposta: Option<String>,
    pub respondida_por: Option<i64>,
    pub respondida_em: Option<DateTime<Utc>>,
    pub status: StatusAvaliacao,
    pub enviado_em: Option<DateTime<Utc>>,
    pub lembrete_em: Option<DateTime<Utc>>,
    pub criado_em: DateTime<Utc>,
}

/// Notas do formulário público — validadas na aplicação (1–5 / 0–10).
#[derive(Debug, Clone, Deserialize)]
pub struct RespostaAvaliacao {
    pub nota_geral: i16,
    pub nota_limpeza: Option<i16>,
    pub nota_atendimento: Option<i16>,
    pub nota_custo: Option<i16>,
    pub nota_localizacao: Option<i16>,
    pub nps: Option<i16>,
    pub comentario: Option<String>,
}

// ---------------------------------------------------------------------------
// fidelidade
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct NivelFidelidade {
    pub id: i64,
    pub nome: String,
    pub min_diarias: i32,
    pub desconto_pct: rust_decimal::Decimal,
    pub beneficios: Option<String>,
    pub ordem: i16,
    pub ativo: bool,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct FidelidadeCliente {
    pub idcliente: i64,
    pub diarias: i32,
    /// Soma dos consumos das estadias, em centavos — base do LTV cash.
    pub gasto_total: i64,
    pub idnivel: Option<i64>,
    pub nivel_nome: Option<String>,
}
