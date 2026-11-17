use crate::integrations::{
    mercadopago::MercadoPagoGateway, pagbank::PagBankGateway, stripe::StripeGateway,
};
use async_trait::async_trait;
use clarituz_domain::entities::{AmbienteIntegracao, ProvedorIntegracao};
use clarituz_domain::ports::{
    CredentialVault, GatewayResolver, IntegracaoRepository, PaymentGateway, ResolucaoGateway,
};
use clarituz_domain::DomainError;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::warn;

fn campo_chave(provedor: ProvedorIntegracao) -> &'static str {
    match provedor {
        ProvedorIntegracao::Stripe => "secret_key",
        ProvedorIntegracao::Pagbank | ProvedorIntegracao::Mercadopago => "access_token",
        ProvedorIntegracao::Zapi => "webhook_segredo",
        ProvedorIntegracao::Spedy => "api_key",
    }
}

pub fn contexto_aad(
    provedor: ProvedorIntegracao,
    ambiente: AmbienteIntegracao,
    campo: &str,
    idintegracao: i64,
) -> String {
    format!(
        "{}|{}|{campo}|{idintegracao}",
        provedor.as_str(),
        ambiente.as_str()
    )
}

type CacheGateway = HashMap<(ProvedorIntegracao, AmbienteIntegracao, i32), Arc<dyn PaymentGateway>>;

pub struct PgGatewayResolver {
    repo: Arc<dyn IntegracaoRepository>,
    vault: Arc<dyn CredentialVault>,
    stripe_env: Option<Arc<dyn PaymentGateway>>,
    cache: RwLock<CacheGateway>,
}

impl PgGatewayResolver {
    pub fn new(
        repo: Arc<dyn IntegracaoRepository>,
        vault: Arc<dyn CredentialVault>,
        stripe_env: Option<Arc<dyn PaymentGateway>>,
    ) -> Self {
        Self {
            repo,
            vault,
            stripe_env,
            cache: RwLock::new(HashMap::new()),
        }
    }

    fn construir(
        &self,
        provedor: ProvedorIntegracao,
        ambiente: AmbienteIntegracao,
        idintegracao: i64,
        segredos: &HashMap<String, Vec<u8>>,
    ) -> Result<Arc<dyn PaymentGateway>, DomainError> {
        if matches!(
            provedor,
            ProvedorIntegracao::Zapi | ProvedorIntegracao::Spedy
        ) {
            return Err(DomainError::regra(
                "provedor sem gateway de pagamento — use o resolver da categoria",
            ));
        }
        let campo = campo_chave(provedor);
        let envelope = segredos.get(campo).ok_or_else(|| {
            DomainError::regra(format!("Integração sem credencial '{campo}' configurada."))
        })?;
        let segredo = self.vault.abrir(
            &contexto_aad(provedor, ambiente, campo, idintegracao),
            envelope,
        )?;

        let gw: Arc<dyn PaymentGateway> = match provedor {
            ProvedorIntegracao::Stripe => Arc::new(StripeGateway::new(segredo)),
            ProvedorIntegracao::Pagbank => Arc::new(PagBankGateway::new(segredo, ambiente)),
            ProvedorIntegracao::Mercadopago => Arc::new(MercadoPagoGateway::new(segredo)),
            ProvedorIntegracao::Zapi | ProvedorIntegracao::Spedy => unreachable!(),
        };
        Ok(gw)
    }
}

#[async_trait]
impl GatewayResolver for PgGatewayResolver {
    async fn resolver(
        &self,
        provedor: ProvedorIntegracao,
        ambiente: AmbienteIntegracao,
    ) -> Result<ResolucaoGateway, DomainError> {
        self.resolver_interno(provedor, ambiente, false).await
    }

    async fn resolver_historico(
        &self,
        provedor: ProvedorIntegracao,
        ambiente: AmbienteIntegracao,
    ) -> Result<ResolucaoGateway, DomainError> {
        self.resolver_interno(provedor, ambiente, true).await
    }

    async fn segredo(&self, idintegracao: i64, campo: &str) -> Result<Option<String>, DomainError> {
        let Some(integ) = self.repo.buscar_por_id(idintegracao).await? else {
            return Ok(None);
        };
        let segredos = self.repo.segredos_enc(idintegracao).await?;
        match segredos.get(campo) {
            Some(env) => Ok(Some(self.vault.abrir(
                &contexto_aad(integ.provedor, integ.ambiente, campo, idintegracao),
                env,
            )?)),
            None => Ok(None),
        }
    }
}

impl PgGatewayResolver {
    async fn resolver_interno(
        &self,
        provedor: ProvedorIntegracao,
        ambiente: AmbienteIntegracao,
        incluir_desativada: bool,
    ) -> Result<ResolucaoGateway, DomainError> {
        let Some(integ) = self.repo.buscar(provedor, ambiente).await? else {
            if provedor == ProvedorIntegracao::Stripe && ambiente == AmbienteIntegracao::Producao {
                if let Some(gw) = &self.stripe_env {
                    return Ok(ResolucaoGateway::Ambiente(gw.clone()));
                }
            }
            return Ok(ResolucaoGateway::Indisponivel);
        };

        if !integ.habilitado && !incluir_desativada {
            return Ok(ResolucaoGateway::Indisponivel);
        }

        let chave = (provedor, ambiente, integ.versao);
        {
            let cache = self.cache.read().await;
            if let Some(gw) = cache.get(&chave) {
                return Ok(ResolucaoGateway::Persistida(gw.clone()));
            }
        }

        let segredos = self.repo.segredos_enc(integ.id).await?;
        let gw = match self.construir(provedor, ambiente, integ.id, &segredos) {
            Ok(g) => g,
            Err(e) => {
                warn!(provedor = provedor.as_str(), erro = %e, "resolver: falha ao construir gateway");
                return Ok(ResolucaoGateway::Indisponivel);
            }
        };
        {
            let mut cache = self.cache.write().await;
            cache.retain(|(p, a, _), _| *p != provedor || *a != ambiente);
            cache.insert(chave, gw.clone());
        }
        Ok(ResolucaoGateway::Persistida(gw))
    }
}
