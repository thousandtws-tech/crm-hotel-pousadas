use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "pdv_comanda_tipo", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum PdvComandaTipo {
    Mesa,
    Quarto,
    Balcao,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "pdv_comanda_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum PdvComandaStatus {
    Aberta,
    Fechada,
    Cancelada,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "pdv_item_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum PdvItemStatus {
    Pendente,
    #[sqlx(rename = "em_preparo")]
    #[serde(rename = "em_preparo")]
    EmPreparo,
    Pronto,
    Entregue,
    Cancelado,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "pdv_comissao_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum PdvComissaoStatus {
    Pendente,
    Paga,
}
