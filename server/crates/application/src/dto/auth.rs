use clarituz_domain::enums::NivelAcesso;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub login: String,
    pub senha: String,
}

#[derive(Debug, Deserialize)]
pub struct RefreshRequest {
    pub refresh_token: String,
}

#[derive(Debug, Deserialize)]
pub struct LogoutRequest {
    pub refresh_token: String,
}

#[derive(Debug, Serialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub token_type: &'static str,
    pub expira_em: i64,
    pub funcionario: FuncionarioView,
}

#[derive(Debug, Serialize)]
pub struct FuncionarioView {
    pub id: i64,
    pub nome: String,
    pub login: String,
    pub nivel: i16,
    pub nivel_nome: &'static str,
    pub ativo: bool,
    /// Permissão granular de operações financeiras (reembolso).
    pub financeiro: bool,
}

impl From<&clarituz_domain::entities::Funcionario> for FuncionarioView {
    fn from(f: &clarituz_domain::entities::Funcionario) -> Self {
        Self {
            id: f.id,
            nome: f.nome.clone(),
            login: f.login.clone(),
            nivel: f.nivel,
            nivel_nome: match NivelAcesso::from_i16(f.nivel) {
                NivelAcesso::Administrador => "Administrador",
                NivelAcesso::Gerente => "Gerente",
                NivelAcesso::Recepcao => "Recepção",
            },
            ativo: f.ativo,
            financeiro: f.financeiro,
        }
    }
}
