//! `GatewayResolver` — resolve o `PaymentGateway` efetivo por
//! (provedor, ambiente) em runtime.
//!
//! A linha `integracao` é lida a cada resolução (fonte de verdade entre
//! réplicas); o adapter só é reconstruído quando a `versao` persistida
//! muda — cache em memória chaveado por (provedor, ambiente, versao).
//!
//! Precedência:
//! 1. Linha existe + habilitada → gateway da config persistida.
//! 2. Linha existe + desabilitada → `Indisponivel` (desativação explícita
//!    não cai no env — nunca).
//! 3. Sem linha → fallback de ambiente (Stripe legado: `STRIPE_SECRET_KEY`).

use crate::integrations::{
    mercadopago::MercadoPagoGateway, pagbank::PagBankGateway, stripe::StripeGateway,
};
use async_trait::async_trait;
use clarituz_domain::entities::{AmbienteIntegracao, ProvedorPagamento};
use clarituz_domain::ports::{
    CredentialVault, GatewayResolver, IntegracaoRepository, PaymentGateway, ResolucaoGateway,
};
use clarituz_domain::DomainError;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::warn;

/// Campos de segredo que cada provedor exige para operar.
fn campo_chave(provedor: ProvedorPagamento) -> &'static str {
    match provedor {
        ProvedorPagamento::Stripe => "secret_key",
        ProvedorPagamento::Pagbank | ProvedorPagamento::Mercadopago => "access_token",
    }
}

pub fn contexto_aad(
    provedor: ProvedorPagamento,
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

/// (provedor, ambiente, versao) → adapter pronto; versão no banco é a
/// fonte de verdade — linha nova gera chave nova e invalida o cache.
type CacheGateway = HashMap<(ProvedorPagamento, AmbienteIntegracao, i32), Arc<dyn PaymentGateway>>;

pub struct PgGatewayResolver {
    repo: Arc<dyn IntegracaoRepository>,
    vault: Arc<dyn CredentialVault>,
    /// Gateway de env para Stripe produção — fallback legado.
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

    /// Constrói o adapter a partir dos segredos persistidos.
    fn construir(
        &self,
        provedor: ProvedorPagamento,
        ambiente: AmbienteIntegracao,
        idintegracao: i64,
        segredos: &HashMap<String, Vec<u8>>,
    ) -> Result<Arc<dyn PaymentGateway>, DomainError> {
        let campo = campo_chave(provedor);
        let envelope = segredos.get(campo).ok_or_else(|| {
            DomainError::regra(format!("Integração sem credencial '{campo}' configurada."))
        })?;
        let segredo = self.vault.abrir(
            &contexto_aad(provedor, ambiente, campo, idintegracao),
            envelope,
        )?;

        let gw: Arc<dyn PaymentGateway> = match provedor {
            ProvedorPagamento::Stripe => Arc::new(StripeGateway::new(segredo)),
            ProvedorPagamento::Pagbank => Arc::new(PagBankGateway::new(segredo, ambiente)),
            ProvedorPagamento::Mercadopago => Arc::new(MercadoPagoGateway::new(segredo)),
        };
        Ok(gw)
    }
}

#[async_trait]
impl GatewayResolver for PgGatewayResolver {
    async fn resolver(
        &self,
        provedor: ProvedorPagamento,
        ambiente: AmbienteIntegracao,
    ) -> Result<ResolucaoGateway, DomainError> {
        self.resolver_interno(provedor, ambiente, false).await
    }

    async fn resolver_historico(
        &self,
        provedor: ProvedorPagamento,
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
        provedor: ProvedorPagamento,
        ambiente: AmbienteIntegracao,
        incluir_desativada: bool,
    ) -> Result<ResolucaoGateway, DomainError> {
        let Some(integ) = self.repo.buscar(provedor, ambiente).await? else {
            // Sem linha persistida: só Stripe produção herda o env legado.
            if provedor == ProvedorPagamento::Stripe && ambiente == AmbienteIntegracao::Producao {
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
            // Evita crescimento: versões antigas saem do cache.
            cache.retain(|(p, a, _), _| *p != provedor || *a != ambiente);
            cache.insert(chave, gw.clone());
        }
        Ok(ResolucaoGateway::Persistida(gw))
    }
}
