use serde::{Deserialize, Serialize};

/// Canal de saída da comunicação com hóspede/equipe. `Inbox` é a
/// notificação interna existente (SSE); os demais são senders externos.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "canal_envio", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum CanalEnvio {
    Email,
    Whatsapp,
    Push,
    Inbox,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "status_envio", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum StatusEnvio {
    Pendente,
    Enviando,
    Enviado,
    Falhou,
    Cancelado,
}

/// Pesquisa pós-estadia: `Pendente` aguarda o hóspede, `Expirada` é
/// marcada pelo sweeper para não contaminar o NPS.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "status_avaliacao", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum StatusAvaliacao {
    Pendente,
    Respondida,
    Expirada,
}
