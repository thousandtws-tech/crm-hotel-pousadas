use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct NovaOrdemInput {
    pub idquarto: Option<i64>,
    pub local: String,
    pub titulo: String,
    pub descricao: String,
    pub prioridade: Option<clarituz_domain::enums::PrioridadeManut>,
    #[serde(default)]
    pub materiais: serde_json::Value,
    pub responsavel: Option<String>,
    pub idfuncionario: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct PmocItemInput {
    pub item: String,
    pub conforme: bool,
    #[serde(default)]
    pub obs: String,
}

#[derive(Debug, Deserialize)]
pub struct NovaPmocInput {
    pub referente_a: chrono::NaiveDate,
    pub itens: Vec<serde_json::Value>,
    pub responsavel_nome: String,
    pub responsavel_crea: String,
    pub responsavel_art: String,
    #[serde(default)]
    pub observacoes: String,
    pub proxima_data: Option<chrono::NaiveDate>,
}

#[derive(Debug, Deserialize)]
pub struct NovaTarefaInput {
    pub idquarto: Option<i64>,
    pub data: Option<chrono::NaiveDate>,
    pub tipo: clarituz_domain::enums::TipoTarefaGov,
    pub estimado_min: Option<i16>,
    pub idfuncionario: Option<i64>,
    #[serde(default)]
    pub observacao: String,
}

#[derive(Debug, Deserialize)]
pub struct NovoLoteInput {
    pub fornecedor: String,
    pub competencia: Option<chrono::NaiveDate>,
    pub qtd_itens: i32,
    #[serde(default)]
    pub custo_centavos: i64,
    #[serde(default)]
    pub observacao: String,
}

#[derive(Debug, Deserialize)]
pub struct NovoMovEnxovalInput {
    pub tipo_item: String,
    pub quantidade: i32,
    pub origem: String,
    pub destino: String,
    pub idlote: Option<i64>,
    pub idquarto: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct JornadaInput {
    pub idfuncionario: i64,
    pub regime: clarituz_domain::enums::RegimeEscala,
    pub entrada: chrono::NaiveTime,
    pub saida: chrono::NaiveTime,
    pub almoco_min: Option<i16>,
    pub ancora: chrono::NaiveDate,
    pub ativo: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct StatusManutInput {
    pub status: clarituz_domain::enums::StatusManut,
    pub custo_centavos: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct StatusTarefaInput {
    pub status: clarituz_domain::enums::StatusTarefaGov,
}

#[derive(Debug, Deserialize)]
pub struct DevolverLoteInput {
    pub qtd_devolvida: i32,
    pub custo_centavos: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct AtribuirTarefaInput {
    pub idfuncionario: i64,
}
