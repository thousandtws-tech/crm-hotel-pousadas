//! `Ator` — identidade autenticada que executa os casos de uso.
//! Produzida pelo middleware JWT da API e carregada nos logs de auditoria.

use clarituz_domain::entities::NovoLog;
use clarituz_domain::enums::NivelAcesso;
use serde_json::Value as JsonValue;

#[derive(Debug, Clone)]
pub struct Ator {
    pub id: i64,
    pub login: String,
    pub nome: String,
    pub nivel: NivelAcesso,
    /// Permissão granular financeira (claim do JWT; admin tem implicitamente).
    pub financeiro: bool,
}

impl Ator {
    pub fn is_admin(&self) -> bool {
        self.nivel.is_admin()
    }

    pub fn is_gerencial(&self) -> bool {
        self.nivel.is_gerencial()
    }

    /// Exige privilégio administrativo — fail-fast para a API.
    pub fn exigir_admin(&self) -> Result<(), clarituz_domain::DomainError> {
        if self.is_admin() {
            Ok(())
        } else {
            Err(clarituz_domain::DomainError::proibido(
                "Ação restrita a administradores.",
            ))
        }
    }

    pub fn exigir_gerencial(&self) -> Result<(), clarituz_domain::DomainError> {
        if self.is_gerencial() {
            Ok(())
        } else {
            Err(clarituz_domain::DomainError::proibido(
                "Ação restrita a gerência ou administração.",
            ))
        }
    }

    /// Exige permissão financeira: admin ou funcionário com a flag
    /// `financeiro` — reembolsos e conciliação passam por aqui.
    pub fn exigir_financeiro(&self) -> Result<(), clarituz_domain::DomainError> {
        if self.is_admin() || self.financeiro {
            Ok(())
        } else {
            Err(clarituz_domain::DomainError::proibido(
                "Ação restrita a usuários com permissão financeira.",
            ))
        }
    }

    /// Monta a entrada de auditoria com o ator embutido.
    pub fn log(
        &self,
        acao: impl Into<String>,
        obs: impl Into<String>,
        tabela: &'static str,
        idtabela: i64,
        dados: Option<JsonValue>,
    ) -> NovoLog {
        NovoLog {
            idfuncionario: Some(self.id),
            acao: acao.into(),
            obs: obs.into(),
            tabela,
            idtabela,
            dados,
        }
    }
}

/// Contexto de transporte da requisição (para sessões e log de acesso).
#[derive(Debug, Clone, Default)]
pub struct RequestCtx {
    pub ip: Option<String>,
    pub user_agent: Option<String>,
}
