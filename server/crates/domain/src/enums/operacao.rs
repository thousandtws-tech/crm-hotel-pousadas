use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "prioridade_manut", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum PrioridadeManut {
    Baixa,
    Media,
    Alta,
    Urgente,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "status_manut", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum StatusManut {
    Aberta,
    EmExecucao,
    AguardandoPeca,
    Concluida,
    Cancelada,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "tipo_tarefa_gov", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum TipoTarefaGov {
    Checkout,
    Stayover,
    Semanal,
    AreaComum,
    Extra,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "status_tarefa_gov", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum StatusTarefaGov {
    Pendente,
    EmAndamento,
    Concluida,
    Cancelada,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "status_lote_lav", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum StatusLoteLav {
    Enviado,
    DevolvidoParcial,
    Devolvido,
    Fechado,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "regime_escala", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum RegimeEscala {
    #[sqlx(rename = "5x1")]
    #[serde(rename = "5x1")]
    CincoUm,
    #[sqlx(rename = "6x1")]
    #[serde(rename = "6x1")]
    SeisUm,
    #[sqlx(rename = "12x36")]
    #[serde(rename = "12x36")]
    DozeTrintaSeis,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "origem_turno", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum OrigemTurno {
    Jornada,
    Manual,
    CltFix,
}
