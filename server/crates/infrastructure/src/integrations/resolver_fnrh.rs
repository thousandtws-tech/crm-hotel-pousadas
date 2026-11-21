//! Resolver FNRH — constrói o adapter SERPRO a partir da integração
//! persistida (módulo Integrações → cofre), com fallback às envs
//! legadas `SERPRO_FNRH_*` quando ainda não há linha configurada.
//!
//! `provedor()` (transmissões reais) usa só a integração de produção
//! **habilitada**; `testar(ambiente)` ignora `habilitado` porque o
//! teste é o portão para habilitar — mesmo desenho do Infobip.

use std::sync::Arc;

use async_trait::async_trait;
use clarituz_domain::entities::{AmbienteIntegracao, ProvedorIntegracao};
use clarituz_domain::ports::{CredentialVault, FnrhResolver, IntegracaoRepository, ProvedorFnrh};
use clarituz_domain::DomainError;

use super::resolver::contexto_aad;
use super::serpro::SerproFnrh;

/// Endpoint por ambiente — homologação (teste) e produção oficiais.
/// `config.base_url` da integração pode sobrescrever quando o SERPRO
/// alterar o host sem deploy.
const URL_PRODUCAO: &str = "https://fnrh.turismo.serpro.gov.br/FNRH_API/rest/v2";
const URL_HOMOLOG: &str = "https://hom-lowcode.serpro.gov.br/FNRH_API/rest/v2";

fn url_padrao(ambiente: AmbienteIntegracao) -> &'static str {
    match ambiente {
        AmbienteIntegracao::Producao => URL_PRODUCAO,
        AmbienteIntegracao::Teste => URL_HOMOLOG,
    }
}

pub struct PgFnrhResolver {
    repo: Arc<dyn IntegracaoRepository>,
    vault: Arc<dyn CredentialVault>,
    /// Adapter das envs `SERPRO_FNRH_*` — fallback até a integração
    /// ser configurada no módulo (migração suave, sem quebra).
    env: Option<Arc<dyn ProvedorFnrh>>,
}

impl PgFnrhResolver {
    pub fn new(
        repo: Arc<dyn IntegracaoRepository>,
        vault: Arc<dyn CredentialVault>,
        env: Option<Arc<dyn ProvedorFnrh>>,
    ) -> Self {
        Self { repo, vault, env }
    }

    /// Adapter do cofre para o ambiente — `None` sem integração ou
    /// quando `exige_habilitado` e ela está desligada. Credenciais
    /// faltando viram erro explícito (não adapter quebrado).
    async fn adapter(
        &self,
        ambiente: AmbienteIntegracao,
        exige_habilitado: bool,
    ) -> Result<Option<Arc<dyn ProvedorFnrh>>, DomainError> {
        let Some(i) = self
            .repo
            .buscar(ProvedorIntegracao::Serpro, ambiente)
            .await?
        else {
            return Ok(None);
        };
        if exige_habilitado && !i.habilitado {
            return Ok(None);
        }
        let segredos = self.repo.segredos_enc(i.id).await?;
        let abrir = |campo: &str| -> Result<Option<String>, DomainError> {
            match segredos.get(campo) {
                Some(env) => Ok(Some(
                    self.vault
                        .abrir(&contexto_aad(i.provedor, i.ambiente, campo, i.id), env)?,
                )),
                None => Ok(None),
            }
        };
        let Some(usuario) = abrir("usuario")? else {
            return Err(DomainError::regra(
                "serpro: credencial 'usuario' não configurada.",
            ));
        };
        let Some(senha) = abrir("senha")? else {
            return Err(DomainError::regra(
                "serpro: credencial 'senha' não configurada.",
            ));
        };
        let Some(cpf) = abrir("cpf_solicitante")? else {
            return Err(DomainError::regra(
                "serpro: credencial 'cpf_solicitante' não configurada.",
            ));
        };
        let base = i.config["base_url"]
            .as_str()
            .map(str::trim)
            .filter(|u| !u.is_empty())
            .unwrap_or_else(|| url_padrao(ambiente));
        Ok(Some(Arc::new(SerproFnrh::new(
            base, &usuario, &senha, &cpf,
        ))))
    }
}

#[async_trait]
impl FnrhResolver for PgFnrhResolver {
    /// Transmissões reais sempre saem pela integração de **produção**
    /// habilitada; a de teste serve para provar credenciais de
    /// homologação. Sem integração → fallback das envs.
    async fn provedor(&self) -> Result<Option<Arc<dyn ProvedorFnrh>>, DomainError> {
        if let Some(a) = self.adapter(AmbienteIntegracao::Producao, true).await? {
            return Ok(Some(a));
        }
        Ok(self.env.clone())
    }

    /// Botão "Testar conexão" — resolve credenciais mesmo antes de
    /// habilitar (o teste é o portão). Em produção, sem integração,
    /// cai no adapter de env.
    async fn testar(&self, ambiente: AmbienteIntegracao) -> Result<Option<String>, DomainError> {
        let adapter = match self.adapter(ambiente, false).await? {
            Some(a) => Some(a),
            None if ambiente == AmbienteIntegracao::Producao => self.env.clone(),
            None => None,
        };
        match adapter {
            Some(a) => Ok(Some(a.testar().await?)),
            None => Ok(None),
        }
    }
}

/// Fallback standalone — quando não há cofre (`INTEGRACOES_MASTER_KEY`
/// ausente) mas as envs `SERPRO_FNRH_*` estão configuradas.
pub struct EnvFnrhResolver(pub Arc<dyn ProvedorFnrh>);

#[async_trait]
impl FnrhResolver for EnvFnrhResolver {
    async fn provedor(&self) -> Result<Option<Arc<dyn ProvedorFnrh>>, DomainError> {
        Ok(Some(self.0.clone()))
    }

    async fn testar(&self, ambiente: AmbienteIntegracao) -> Result<Option<String>, DomainError> {
        if ambiente != AmbienteIntegracao::Producao {
            return Ok(None);
        }
        Ok(Some(self.0.testar().await?))
    }
}
