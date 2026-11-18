use serde::{Deserialize, Serialize};

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
    /// Intenção obsoleta por transição posterior (ex.: aviso de pendência
    /// substituído pela confirmação) — auditável, nunca reenviado.
    Suprimido,
    /// Sem resposta do provedor — pode ter saído ou não. Não reenvia
    /// automaticamente; exige reconciliação ou reenvio manual auditado.
    Desconhecido,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "status_avaliacao", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum StatusAvaliacao {
    Pendente,
    Respondida,
    Expirada,
}
