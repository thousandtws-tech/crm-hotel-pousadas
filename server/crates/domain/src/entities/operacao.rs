use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

use crate::enums::{
    OrigemTurno, PrioridadeManut, RegimeEscala, StatusLoteLav, StatusManut, StatusTarefaGov,
    TipoTarefaGov,
};

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct ManutencaoOrdem {
    pub id: i64,
    pub idquarto: Option<i64>,
    pub local: String,
    pub titulo: String,
    pub descricao: String,
    pub prioridade: PrioridadeManut,
    pub status: StatusManut,
    pub custo_centavos: i64,
    pub materiais: serde_json::Value,
    pub responsavel: Option<String>,
    pub idfuncionario: Option<i64>,
    pub criado_por: Option<i64>,
    pub aberta_em: DateTime<Utc>,
    pub concluida_em: Option<DateTime<Utc>>,
    pub version: i32,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct PmocRegistro {
    pub id: i64,
    pub referente_a: NaiveDate,
    pub itens: serde_json::Value,
    pub conformes: i16,
    pub responsavel_nome: String,
    pub responsavel_crea: String,
    pub responsavel_art: String,
    pub observacoes: String,
    pub proxima_data: Option<NaiveDate>,
    pub criado_por: Option<i64>,
    pub criado_em: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct GovernancaTarefa {
    pub id: i64,
    pub idquarto: Option<i64>,
    pub data: NaiveDate,
    pub tipo: TipoTarefaGov,
    pub status: StatusTarefaGov,
    pub estimado_min: i16,
    pub idfuncionario: Option<i64>,
    pub origem: String,
    pub observacao: String,
    pub concluida_em: Option<DateTime<Utc>>,
    pub criado_em: DateTime<Utc>,
    pub version: i32,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct LavanderiaLote {
    pub id: i64,
    pub fornecedor: String,
    pub competencia: NaiveDate,
    pub enviado_em: DateTime<Utc>,
    pub devolvido_em: Option<DateTime<Utc>>,
    pub qtd_itens: i32,
    pub qtd_devolvida: i32,
    pub custo_centavos: i64,
    pub status: StatusLoteLav,
    pub idlancamento: Option<i64>,
    pub observacao: String,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct EnxovalMov {
    pub id: i64,
    pub tipo_item: String,
    pub quantidade: i32,
    pub origem: String,
    pub destino: String,
    pub idlote: Option<i64>,
    pub idquarto: Option<i64>,
    pub data: DateTime<Utc>,
    pub registrado_por: Option<i64>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct FuncionarioJornada {
    pub id: i64,
    pub idfuncionario: i64,
    pub regime: RegimeEscala,
    pub entrada: NaiveTime,
    pub saida: NaiveTime,
    pub almoco_min: i16,
    pub ancora: NaiveDate,
    pub ativo: bool,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct EscalaTurno {
    pub id: i64,
    pub idfuncionario: i64,
    pub data: NaiveDate,
    pub inicio: DateTime<Utc>,
    pub fim: DateTime<Utc>,
    pub almoco_min: i16,
    pub origem: OrigemTurno,
    pub version: i32,
}

#[derive(Debug, Clone, Serialize)]
pub struct CltViolacao {
    pub idfuncionario: i64,
    pub funcionario_nome: String,
    pub regra: String, 
    pub detalhe: String,
    pub data: NaiveDate,
    pub severidade: String, 
    pub correcao: Option<CltCorrecao>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "acao", rename_all = "snake_case")]
pub enum CltCorrecao {
    EncurtarTurno {
        idturno: i64,
        novo_fim: DateTime<Utc>,
    },
    AjustarAlmoco { idturno: i64, novo_almoco_min: i16 },
    Folgar { idturno: i64 },
    EmpurrarInicio {
        idturno: i64,
        novo_inicio: DateTime<Utc>,
    },
}
