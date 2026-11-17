use crate::actor::Ator;
use crate::dto::{HabilitacaoInput, SalvarIntegracaoInput};
use crate::error::AppResult;
use clarituz_domain::entities::{
    AmbienteIntegracao, Integracao, ProvedorPagamento, StatusVerificacao,
};
use clarituz_domain::ports::{
    AtualizacaoIntegracao, CredentialVault, EstadoEfetivo, EventoIntegracaoView, GatewayResolver,
    IntegracaoRepository, IntegracaoView, MapaSegredosView, NovaIntegracao, ResolucaoGateway,
    ESCOPO_PAGAMENTOS_SITE,
};
use clarituz_domain::DomainError;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use tracing::info;

fn campos_permitidos(provedor: ProvedorPagamento) -> &'static [&'static str] {
    match provedor {
        ProvedorPagamento::Stripe => &["secret_key", "webhook_secret", "public_key"],
        ProvedorPagamento::Pagbank => &["access_token", "authenticity_token"],
        ProvedorPagamento::Mercadopago => &["access_token", "webhook_secret", "public_key"],
    }
}

fn contexto_aad(p: ProvedorPagamento, a: AmbienteIntegracao, campo: &str, id: i64) -> String {
    format!("{}|{}|{campo}|{id}", p.as_str(), a.as_str())
}

fn capabilities_padrao(provedor: ProvedorPagamento) -> serde_json::Value {
    match provedor {
        ProvedorPagamento::Stripe => serde_json::json!({
            "checkout": true, "reembolso": true, "checkout_expiravel": true,
            "webhook_assinado": true, "conciliacao": true,
        }),
        ProvedorPagamento::Pagbank => serde_json::json!({
            "checkout": true, "reembolso": true, "checkout_expiravel": true,
            "webhook_assinado": false, "webhook_fetchback": true, "conciliacao": true,
        }),
        ProvedorPagamento::Mercadopago => serde_json::json!({
            "checkout": true, "reembolso": true, "checkout_expiravel": false,
            "webhook_assinado": true, "conciliacao": true,
        }),
    }
}

pub struct IntegracoesService {
    repo: Arc<dyn IntegracaoRepository>,
    vault: Arc<dyn CredentialVault>,
    resolver: Arc<dyn GatewayResolver>,
    pagamentos: Arc<dyn clarituz_domain::ports::PagamentoRepository>,
    stripe_env_ativo: bool,
}

#[derive(Debug, Serialize)]
pub struct TesteConexaoOutput {
    pub verificacao_status: String,
    pub nome_conta: Option<String>,
    pub mensagem: String,
}

impl IntegracoesService {
    pub fn new(
        repo: Arc<dyn IntegracaoRepository>,
        vault: Arc<dyn CredentialVault>,
        resolver: Arc<dyn GatewayResolver>,
        pagamentos: Arc<dyn clarituz_domain::ports::PagamentoRepository>,
        stripe_env_ativo: bool,
    ) -> Self {
        Self {
            repo,
            vault,
            resolver,
            pagamentos,
            stripe_env_ativo,
        }
    }

    pub async fn catalogo(&self, ator: &Ator) -> AppResult<Vec<IntegracaoView>> {
        ator.exigir_admin()?;
        let rows = self.repo.listar().await?;
        let padrao = self.repo.padrao(ESCOPO_PAGAMENTOS_SITE).await?;
        let mut out = Vec::new();
        for provedor in [
            ProvedorPagamento::Stripe,
            ProvedorPagamento::Pagbank,
            ProvedorPagamento::Mercadopago,
        ] {
            for ambiente in [AmbienteIntegracao::Teste, AmbienteIntegracao::Producao] {
                out.push(self.view(provedor, ambiente, &rows, padrao).await?);
            }
        }
        Ok(out)
    }

    async fn view(
        &self,
        provedor: ProvedorPagamento,
        ambiente: AmbienteIntegracao,
        rows: &[Integracao],
        padrao: Option<(ProvedorPagamento, AmbienteIntegracao, i64)>,
    ) -> AppResult<IntegracaoView> {
        let Some(i) = rows
            .iter()
            .find(|r| r.provedor == provedor && r.ambiente == ambiente)
        else {
            let estado = if provedor == ProvedorPagamento::Stripe
                && ambiente == AmbienteIntegracao::Producao
                && self.stripe_env_ativo
            {
                EstadoEfetivo::GerenciadoPeloAmbiente
            } else {
                EstadoEfetivo::NaoConfigurada
            };
            return Ok(IntegracaoView {
                provedor,
                ambiente,
                estado,
                habilitado: false,
                nome_conta: None,
                capabilities: capabilities_padrao(provedor),
                webhook_url: None,
                segredos: MapaSegredosView::default(),
                ultima_verificacao_em: None,
                verificacao_status: None,
                verificacao_erro: None,
                versao: 0,
                padrao_site: false,
            });
        };
        let segredos = self.repo.mapa_segredos(i.id).await?;
        let estado = if i.habilitado {
            match i.verificacao_status.as_deref() {
                Some("ok") => EstadoEfetivo::Ativa,
                Some("falha") => EstadoEfetivo::Falha,
                _ => EstadoEfetivo::Pendente,
            }
        } else {
            EstadoEfetivo::Desativada
        };
        Ok(IntegracaoView {
            provedor,
            ambiente,
            estado,
            habilitado: i.habilitado,
            nome_conta: i.nome_conta.clone(),
            capabilities: i.capabilities.clone(),
            webhook_url: i.webhook_url.clone(),
            segredos: segredos.into(),
            ultima_verificacao_em: i.ultima_verificacao_em,
            verificacao_status: i.verificacao_status.clone(),
            verificacao_erro: i.verificacao_erro.clone(),
            versao: i.versao,
            padrao_site: padrao
                .is_some_and(|(p, a, id)| p == provedor && a == ambiente && id == i.id),
        })
    }

    pub async fn detalhe(
        &self,
        ator: &Ator,
        provedor: ProvedorPagamento,
        ambiente: AmbienteIntegracao,
    ) -> AppResult<IntegracaoView> {
        ator.exigir_admin()?;
        let rows = self.repo.listar().await?;
        let padrao = self.repo.padrao(ESCOPO_PAGAMENTOS_SITE).await?;
        self.view(provedor, ambiente, &rows, padrao).await
    }

    pub async fn salvar(
        &self,
        ator: &Ator,
        provedor: ProvedorPagamento,
        ambiente: AmbienteIntegracao,
        input: SalvarIntegracaoInput,
    ) -> AppResult<IntegracaoView> {
        ator.exigir_admin()?;
        let atual = self
            .repo
            .garantir(&NovaIntegracao {
                provedor,
                ambiente,
                criado_por: Some(ator.id),
            })
            .await?;
        if atual.versao != input.versao {
            return Err(DomainError::conflito(
                "A configuração foi alterada. Recarregue antes de salvar.",
            )
            .into());
        }

        let mut segredos_enc: HashMap<String, Vec<u8>> = HashMap::new();
        if let Some(mapa) = &input.segredos {
            for (campo, valor) in mapa {
                if !campos_permitidos(provedor).contains(&campo.as_str()) {
                    return Err(DomainError::validacao(format!(
                        "Campo de segredo não suportado por {}: {campo}",
                        provedor.as_str()
                    ))
                    .into());
                }
                let enc = if valor.is_empty() {
                    Vec::new()
                } else {
                    self.vault
                        .selar(&contexto_aad(provedor, ambiente, campo, atual.id), valor)?
                };
                segredos_enc.insert(campo.clone(), enc);
            }
        }

        let salvo = self
            .repo
            .salvar(
                atual.id,
                input.versao,
                &AtualizacaoIntegracao {
                    segredos: None,
                    nome_conta: input.nome_conta.clone(),
                    webhook_url: input.webhook_url.clone(),
                },
                &segredos_enc,
                Some(ator.id),
            )
            .await?;
        info!(
            provedor = provedor.as_str(),
            ambiente = ambiente.as_str(),
            ator = %ator.login,
            "integração atualizada"
        );
        let rows = self.repo.listar().await?;
        let padrao = self.repo.padrao(ESCOPO_PAGAMENTOS_SITE).await?;
        let _ = salvo;
        self.view(provedor, ambiente, &rows, padrao).await
    }

    pub async fn habilitacao(
        &self,
        ator: &Ator,
        provedor: ProvedorPagamento,
        ambiente: AmbienteIntegracao,
        input: HabilitacaoInput,
    ) -> AppResult<IntegracaoView> {
        ator.exigir_admin()?;
        let i = self
            .repo
            .buscar(provedor, ambiente)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Integração não configurada."))?;
        if input.habilitado && i.verificacao_status.as_deref() != Some("ok") {
            return Err(DomainError::regra(
                "Teste a conexão com sucesso antes de habilitar a integração.",
            )
            .into());
        }
        let salvo = self
            .repo
            .definir_habilitado(i.id, input.habilitado, Some(ator.id))
            .await?;
        if !input.habilitado {
            self.repo.limpar_padrao_se(salvo.id).await?;
        }
        info!(
            provedor = provedor.as_str(),
            habilitado = input.habilitado,
            ator = %ator.login,
            "habilitação de integração"
        );
        self.detalhe(ator, provedor, ambiente).await
    }

    pub async fn testar(
        &self,
        ator: &Ator,
        provedor: ProvedorPagamento,
        ambiente: AmbienteIntegracao,
    ) -> AppResult<TesteConexaoOutput> {
        ator.exigir_admin()?;
        let i = self
            .repo
            .buscar(provedor, ambiente)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Integração não configurada."))?;

        let resultado = match self.resolver.resolver(provedor, ambiente).await? {
            ResolucaoGateway::Persistida(gw) | ResolucaoGateway::Ambiente(gw) => {
                match gw.testar_conexao().await {
                    Ok(rotulo) => (StatusVerificacao::Ok, None, Some(rotulo)),
                    Err(e) => (StatusVerificacao::Falha, Some(e.to_string()), None),
                }
            }
            ResolucaoGateway::Indisponivel => (
                StatusVerificacao::Falha,
                Some("Sem credenciais configuradas para teste.".into()),
                None,
            ),
        };
        let (status, erro, conta) = resultado;
        let caps = capabilities_padrao(provedor);
        self.repo
            .registrar_verificacao(
                i.id,
                i.versao,
                status,
                erro.as_deref(),
                conta.as_deref(),
                &caps,
            )
            .await?;
        Ok(TesteConexaoOutput {
            verificacao_status: status.as_str().into(),
            nome_conta: conta,
            mensagem: match status {
                StatusVerificacao::Ok => "Conexão verificada com sucesso.".into(),
                StatusVerificacao::ValidacaoLocal => {
                    "Validação local concluída — sem leitura segura no provedor.".into()
                }
                StatusVerificacao::Falha => erro
                    .clone()
                    .unwrap_or_else(|| "Falha na verificação.".into()),
            },
        })
    }

    pub async fn definir_padrao(
        &self,
        ator: &Ator,
        provedor: ProvedorPagamento,
        ambiente: AmbienteIntegracao,
    ) -> AppResult<()> {
        ator.exigir_admin()?;
        let i = self
            .repo
            .buscar(provedor, ambiente)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Integração não configurada."))?;
        if !i.habilitado {
            return Err(DomainError::regra(
                "Habilite a integração antes de defini-la como padrão.",
            )
            .into());
        }
        self.repo
            .definir_padrao(ESCOPO_PAGAMENTOS_SITE, i.id, Some(ator.id))
            .await?;
        info!(provedor = provedor.as_str(), ator = %ator.login, "provedor padrão alterado");
        Ok(())
    }

    pub async fn eventos(
        &self,
        ator: &Ator,
        provedor: ProvedorPagamento,
        ambiente: AmbienteIntegracao,
        limite: i64,
    ) -> AppResult<Vec<EventoIntegracaoView>> {
        ator.exigir_admin()?;
        let i = self
            .repo
            .buscar(provedor, ambiente)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Integração não configurada."))?;
        let eventos = self
            .pagamentos
            .eventos_da_integracao(i.id, limite.clamp(1, 100))
            .await?;
        Ok(eventos
            .into_iter()
            .map(|e| EventoIntegracaoView {
                event_id: e.event_id,
                event_type: e.event_type,
                status: format!("{:?}", e.status).to_lowercase(),
                ultimo_erro: e.ultimo_erro,
                recebido_em: e.recebido_em,
                processado_em: e.processado_em,
            })
            .collect())
    }

    pub async fn provedor_padrao_site(
        &self,
    ) -> AppResult<Option<(ProvedorPagamento, AmbienteIntegracao, i64)>> {
        Ok(self.repo.padrao(ESCOPO_PAGAMENTOS_SITE).await?)
    }

    /// Linha crua de uma integração — uso interno dos receptores de
    /// webhook (sem ator nem view). `Some` mesmo desabilitada: o receptor
    /// decide a precedência (persistida governa, env não resgata).
    pub async fn buscar_integracao(
        &self,
        provedor: ProvedorPagamento,
        ambiente: AmbienteIntegracao,
    ) -> AppResult<Option<Integracao>> {
        Ok(self.repo.buscar(provedor, ambiente).await?)
    }

    pub async fn habilitadas(&self, provedor: ProvedorPagamento) -> AppResult<Vec<Integracao>> {
        Ok(self
            .repo
            .listar()
            .await?
            .into_iter()
            .filter(|i| i.provedor == provedor && i.habilitado)
            .collect())
    }

    pub async fn segredo_webhook(
        &self,
        idintegracao: i64,
        campo: &str,
    ) -> AppResult<Option<String>> {
        Ok(self.resolver.segredo(idintegracao, campo).await?)
    }

    pub async fn gateway_da_integracao(
        &self,
        idintegracao: i64,
    ) -> AppResult<Option<Arc<dyn clarituz_domain::ports::PaymentGateway>>> {
        let Some(i) = self.repo.buscar_por_id(idintegracao).await? else {
            return Ok(None);
        };
        Ok(
            match self
                .resolver
                .resolver_historico(i.provedor, i.ambiente)
                .await?
            {
                ResolucaoGateway::Persistida(gw) | ResolucaoGateway::Ambiente(gw) => Some(gw),
                ResolucaoGateway::Indisponivel => None,
            },
        )
    }
}
