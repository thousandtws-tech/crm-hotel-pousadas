use chrono::NaiveDate;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct FuncionarioInput {
    pub nome: String,
    pub login: String,
    pub senha: String,
    pub cpf: Option<String>,
    pub data_nascimento: Option<NaiveDate>,
    pub nivel: i16,
}

/// Auto-cadastro pela tela de login — cria conta de administrador; os demais
/// níveis (Recepção, Gerente) são criados no painel.
#[derive(Debug, Deserialize)]
pub struct RegistroInput {
    pub nome: String,
    pub login: String,
    pub senha: String,
}

#[derive(Debug, Deserialize)]
pub struct FuncionarioUpdate {
    pub nome: Option<String>,
    pub login: Option<String>,
    /// Quando presente, redefine a senha.
    pub senha: Option<String>,
    pub cpf: Option<String>,
    pub data_nascimento: Option<NaiveDate>,
    pub nivel: Option<i16>,
    /// Concorrência otimista.
    pub version: Option<i64>,
}
