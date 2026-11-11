use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct FrigobarInput {
    pub idacomodacao: i64,
    pub modelo: Option<String>,
    pub patrimonio: Option<String>,
    /// Concorrência otimista — só em PUT.
    pub version: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct ItemFrigobarInput {
    pub iditem: i64,
    pub quantidade: i32,
}

#[derive(Debug, Deserialize)]
pub struct QuantidadeInput {
    pub quantidade: i32,
    /// Concorrência otimista — só em PUT.
    pub version: Option<i64>,
}
