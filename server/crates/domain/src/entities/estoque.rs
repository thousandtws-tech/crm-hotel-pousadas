use crate::enums::TipoMovimento;
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::Serialize;
use sqlx::FromRow;

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct CategoriaEstoque {
    pub id: i64,
    pub nome: String,
    pub impressora_id: Option<i64>,
    pub ativo: bool,
    pub version: i64,
    pub criado_em: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct ItemEstoque {
    pub id: i64,
    pub nome: String,
    pub idcategoria: Option<i64>,
    pub quantidade: i32,
    pub valor_unitario: Decimal,
    pub unidade: String,
    pub estoque_minimo: i32,
    pub eh_insumo: bool,
    pub ativo: bool,
    pub version: i64,
    pub criado_em: DateTime<Utc>,
    pub atualizado_em: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct MovimentoEstoque {
    pub id: i64,
    pub iditem: i64,
    pub tipo: TipoMovimento,
    pub quantidade: i32,
    pub idfuncionario: Option<i64>,
    pub motivo: String,
    pub criado_em: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct FichaTecnica {
    pub id: i64,
    pub idproduto: i64,
    pub idinsumo: i64,
    pub quantidade: i32,
    pub criado_em: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct ConversaoUnidade {
    pub id: i64,
    pub iditem: i64,
    pub unidade_compra: String,
    pub fator: i32,
    pub criado_em: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct NfeImport {
    pub id: i64,
    pub chave: String,
    pub numero: Option<String>,
    pub emitente: Option<String>,
    pub cnpj: Option<String>,
    pub emissao: Option<chrono::NaiveDate>,
    pub total: Decimal,
    pub idlancamento: Option<i64>,
    pub importado_por: Option<i64>,
    pub criado_em: DateTime<Utc>,
}
