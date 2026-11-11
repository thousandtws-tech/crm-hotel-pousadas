use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct VinculoAcomodacaoInput {
    pub idacomodacao: Option<i64>,
}
#[derive(Debug, Deserialize)]
pub struct VagaInput {
    pub numero: String,
}
