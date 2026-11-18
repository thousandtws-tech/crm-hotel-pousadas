use chrono::NaiveDate;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct FuncionarioInput {
    pub nome: String,
    pub login: String,
    pub senha: String,
    pub cpf: Option<String>,
    pub data_nascimento: Option<NaiveDate>,
    /// `nivel` legado — usado só quando `cargo_id` não vem.
    #[serde(default)]
    pub nivel: i16,
    /// Cargo escolhido no painel — determina o `nivel` efetivo.
    pub cargo_id: Option<i64>,
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
    /// Troca de cargo — quando presente, redefine `nivel` a partir dele.
    pub cargo_id: Option<i64>,
    /// Concorrência otimista.
    pub version: Option<i64>,
}
