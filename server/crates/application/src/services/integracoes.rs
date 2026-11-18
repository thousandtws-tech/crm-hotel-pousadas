use crate::actor::Ator;
use crate::dto::{HabilitacaoInput, MensagemTesteInput, SalvarIntegracaoInput};
use crate::error::AppResult;
use clarituz_domain::entities::{
    AmbienteIntegracao, Integracao, ProvedorIntegracao, StatusVerificacao,
};
use clarituz_domain::ports::{
    AtualizacaoIntegracao, ComunicacaoEventoRepository, ComunicacaoResolver, CredentialVault,
    EstadoEfetivo, EventoIntegracaoView, GatewayResolver, IntegracaoRepository, IntegracaoView,
    MapaSegredosView, NovaIntegracao, ResolucaoGateway, ZApiQrView, ESCOPO_PAGAMENTOS_SITE,
};
use clarituz_domain::DomainError;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use tracing::info;

fn campos_permitidos(provedor: ProvedorIntegracao) -> &'static [&'static str] {
    match provedor {
        ProvedorIntegracao::Stripe => &["secret_key", "webhook_secret", "public_key"],
        ProvedorIntegracao::Pagbank => &["access_token", "authenticity_token"],
        ProvedorIntegracao::Mercadopago => &["access_token", "webhook_secret", "public_key"],
        ProvedorIntegracao::Zapi => &["instance_token", "client_token", "webhook_segredo"],
        // Spedy: chave por empresa (X-Api-Key) + segredo whsec_ do webhook.
        // Didit: sk_test_/sk_live_ (x-api-key) + secret_shared_key do webhook.
        // Channex: user-api-key + signing secret do webhook HMAC
        // (x-hmac-signature-256) — capturado ao criar a signing key.
        ProvedorIntegracao::Spedy | ProvedorIntegracao::Didit | ProvedorIntegracao::Channex => {
            &["api_key", "webhook_secret"]
        }
        // Infobip: `api_key` (App auth) + `webhook_secret` gerado pelo
        // sistema na 1ª gravação — autentica o DLR no path do callback.
        ProvedorIntegracao::Infobip => &["api_key", "webhook_secret"],
    }
}

/// Chaves de `config` (não-secreta) aceitas por provedor — Z-API grava
/// aqui o `instance_id`; sessão/número chegam via webhook (`mesclar_config`).
fn config_permitida(provedor: ProvedorIntegracao) -> &'static [&'static str] {
    match provedor {
        ProvedorIntegracao::Zapi => &["instance_id"],
        // Spedy: vínculo da empresa, município de emissão e a
        // parametrização fiscal aprovada pelo responsável — nada de
        // valores fiscais inventados pelo código.
        ProvedorIntegracao::Spedy => &[
            "empresa_id",
            "empresa_cnpj",
            "empresa_razao",
            "empresa_cnpj_divergente",
            "municipio_codigo",
            "municipio_nome",
            "municipio_provedores",
            "fiscal_service_code",
            "fiscal_city_service_code",
            "fiscal_cnae",
            "fiscal_nbs",
            "fiscal_national_taxation_code",
            "fiscal_taxation_type",
            "fiscal_iss_rate",
            "fiscal_descricao",
            "fiscal_ambiente",
            "fiscal_issue_type",
            "webhook_registrado",
            "automacao_evento",
        ],
        // Didit: workflow KYC, retorno hospedado e o portão de login.
        ProvedorIntegracao::Didit => &[
            "workflow_id",
            "callback_url",
            "exigir_verificacao",
            "webhook_registrado",
            "webhook_destino_id",
        ],
        // Channex: propriedade remota vinculada, webhook e o estado de
        // publicação — credencial nunca em config.
        ProvedorIntegracao::Channex => &[
            "property_id",
            "property_title",
            "webhook_registrado",
            "webhook_id",
            "webhook_signing_key_id",
            "publicacao_pausada",
        ],
        // Infobip: endpoint/remetente/segmentos, toggles de evento da
        // matriz pós-reserva, pausa operacional e allowlist do teste.
        ProvedorIntegracao::Infobip => &[
            "base_url",
            "remetente",
            "limite_segmentos",
            "callback_url",
            "eventos",
            "envio_pausado",
            "destinatarios_teste",
            "webhook_registrado",
        ],
        _ => &[],
    }
}

fn contexto_aad(p: ProvedorIntegracao, a: AmbienteIntegracao, campo: &str, id: i64) -> String {
    format!("{}|{}|{campo}|{id}", p.as_str(), a.as_str())
}

/// Remetente SMS aceito pelas operadoras: alfanumérico (≤11, letras/
/// dígitos/espaço) ou long code numérico (≤15, com ou sem `+`).
fn validar_remetente_sms(rem: &str) -> Result<(), DomainError> {
    let r = rem.trim();
    let alfanum = !r.is_empty()
        && r.chars().count() <= 11
        && r.chars().all(|c| c.is_ascii_alphanumeric() || c == ' ');
    let numerico = {
        let d: String = r.chars().filter(|c| c.is_ascii_digit()).collect();
        !d.is_empty() && d.len() <= 15 && r.chars().all(|c| c.is_ascii_digit() || c == '+')
    };
    if alfanum || numerico {
        Ok(())
    } else {
        Err(DomainError::validacao(
            "Remetente inválido — use alfanumérico (até 11 caracteres) \
             ou número no formato internacional.",
        ))
    }
}

/// Escopo do botão "definir padrão" — comunicação usa `whatsapp`.
fn escopo_padrao(provedor: ProvedorIntegracao) -> &'static str {
    match provedor {
        ProvedorIntegracao::Zapi => "whatsapp",
        ProvedorIntegracao::Infobip => "sms",
        ProvedorIntegracao::Spedy => "fiscal",
        ProvedorIntegracao::Didit => "verificacao",
        ProvedorIntegracao::Channex => "distribuicao",
        _ => ESCOPO_PAGAMENTOS_SITE,
    }
}

fn capabilities_padrao(provedor: ProvedorIntegracao) -> serde_json::Value {
    match provedor {
        ProvedorIntegracao::Stripe => serde_json::json!({
            "checkout": true, "reembolso": true, "checkout_expiravel": true,
            "webhook_assinado": true, "conciliacao": true,
        }),
        ProvedorIntegracao::Pagbank => serde_json::json!({
            "checkout": true, "reembolso": true, "checkout_expiravel": true,
            "webhook_assinado": false, "webhook_fetchback": true, "conciliacao": true,
        }),
        ProvedorIntegracao::Mercadopago => serde_json::json!({
            "checkout": true, "reembolso": true, "checkout_expiravel": false,
            "webhook_assinado": true, "conciliacao": true,
        }),
        ProvedorIntegracao::Zapi => serde_json::json!({
            "canal": "whatsapp", "qr_code": true, "desconexao_remota": true,
            "callback_segredo_url": true,
            "callbacks": ["received", "delivery", "message-status", "connected", "disconnected"],
            "estados": ["aceito", "enviado", "entregue", "lido"],
        }),
        ProvedorIntegracao::Spedy => serde_json::json!({
            "modelos": ["nfse"], "emissao_assincrona": true,
            "webhook_assinado": true, "cancelamento": true,
            "consulta_municipio": true, "documentos": ["pdf", "xml"],
            "idempotencia": "integrationId",
        }),
        ProvedorIntegracao::Didit => serde_json::json!({
            "kyc": true, "sessao_hospedada": true, "webhook_assinado": true,
            "sincronizacao": true, "verificacao_login": true,
        }),
        ProvedorIntegracao::Channex => serde_json::json!({
            "ari": ["availability", "restrictions"],
            "revisoes": ["new", "modified", "cancelled"],
            "feed": true, "webhook_assinado": true, "ack": true,
            "canal_iframe": true, "reconciliacao": true,
            "rate_limit_por_propriedade": {"availability": 10, "restrictions": 10},
        }),
        ProvedorIntegracao::Infobip => serde_json::json!({
            "canal": "sms", "remetente_alfanumerico": true,
            "segmentos_limite": true, "callback_segredo_url": true,
            "dlr": ["delivered", "rejected", "undeliverable", "expired", "pending"],
            "estados": ["aceito", "enviado", "entregue", "falhou"],
        }),
    }
}

pub struct IntegracoesService {
    repo: Arc<dyn IntegracaoRepository>,
    vault: Arc<dyn CredentialVault>,
    resolver: Arc<dyn GatewayResolver>,
    /// Resolução/credenciais de comunicação (Z-API) — `None` em testes.
    com: Option<Arc<dyn ComunicacaoResolver>>,
    com_eventos: Option<Arc<dyn ComunicacaoEventoRepository>>,
    /// Serviço fiscal (Spedy) — teste de conexão delega à empresa remota.
    fiscal: Option<Arc<crate::services::fiscal::FiscalService>>,
    /// Serviço de verificação (Didit) — teste de conexão delega ao provedor.
    verificacao: Option<Arc<crate::services::verificacao::VerificacaoService>>,
    /// Distribuição (Channex) — teste de conexão delega à leitura remota.
    distribuicao: Option<Arc<crate::services::channex::ChannexService>>,
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
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        repo: Arc<dyn IntegracaoRepository>,
        vault: Arc<dyn CredentialVault>,
        resolver: Arc<dyn GatewayResolver>,
        com: Option<Arc<dyn ComunicacaoResolver>>,
        com_eventos: Option<Arc<dyn ComunicacaoEventoRepository>>,
        fiscal: Option<Arc<crate::services::fiscal::FiscalService>>,
        verificacao: Option<Arc<crate::services::verificacao::VerificacaoService>>,
        distribuicao: Option<Arc<crate::services::channex::ChannexService>>,
        pagamentos: Arc<dyn clarituz_domain::ports::PagamentoRepository>,
        stripe_env_ativo: bool,
    ) -> Self {
        Self {
            repo,
            vault,
            resolver,
            com,
            com_eventos,
            fiscal,
            verificacao,
            distribuicao,
            pagamentos,
            stripe_env_ativo,
        }
    }

    pub async fn catalogo(&self, ator: &Ator) -> AppResult<Vec<IntegracaoView>> {
        ator.exigir_admin()?;
        let rows = self.repo.listar().await?;
        let mut out = Vec::new();
        for provedor in [
            ProvedorIntegracao::Stripe,
            ProvedorIntegracao::Pagbank,
            ProvedorIntegracao::Mercadopago,
            ProvedorIntegracao::Zapi,
            ProvedorIntegracao::Spedy,
            ProvedorIntegracao::Didit,
            ProvedorIntegracao::Channex,
            ProvedorIntegracao::Infobip,
        ] {
            let padrao = self.repo.padrao(escopo_padrao(provedor)).await?;
            for ambiente in provedor.ambientes() {
                out.push(self.view(provedor, *ambiente, &rows, padrao).await?);
            }
        }
        Ok(out)
    }

    async fn view(
        &self,
        provedor: ProvedorIntegracao,
        ambiente: AmbienteIntegracao,
        rows: &[Integracao],
        padrao: Option<(ProvedorIntegracao, AmbienteIntegracao, i64)>,
    ) -> AppResult<IntegracaoView> {
        let Some(i) = rows
            .iter()
            .find(|r| r.provedor == provedor && r.ambiente == ambiente)
        else {
            let estado = if provedor == ProvedorIntegracao::Stripe
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
                categoria: provedor.categoria().to_string(),
                estado,
                habilitado: false,
                nome_conta: None,
                capabilities: capabilities_padrao(provedor),
                config: serde_json::json!({}),
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
            categoria: i.categoria.clone(),
            estado,
            habilitado: i.habilitado,
            nome_conta: i.nome_conta.clone(),
            capabilities: i.capabilities.clone(),
            config: i.config.clone(),
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
        provedor: ProvedorIntegracao,
        ambiente: AmbienteIntegracao,
    ) -> AppResult<IntegracaoView> {
        ator.exigir_admin()?;
        let rows = self.repo.listar().await?;
        let padrao = self.repo.padrao(escopo_padrao(provedor)).await?;
        self.view(provedor, ambiente, &rows, padrao).await
    }

    pub async fn salvar(
        &self,
        ator: &Ator,
        provedor: ProvedorIntegracao,
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
        // `versao: 0` = o cliente ainda não conhece a linha (view de uma
        // integração nunca persistida expõe 0). `garantir` acabou de criá-la
        // com versao 1 — "criada, nunca atualizada" — então 0 casa com 1.
        let versao_esperada = if input.versao == 0 && atual.versao == 1 {
            1
        } else {
            input.versao
        };
        if atual.versao != versao_esperada {
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

        // Mercado Pago: credenciais têm prefixo inequívoco — `TEST-` é de
        // teste e `APP_USR-` de produção. Token de teste salvo na linha de
        // produção cria preferências que redirecionam para um checkout onde
        // o pagamento nunca conclui; bloquear na escrita evita o modo
        // silencioso mais comum de "checkout quebrado em produção".
        if provedor == ProvedorIntegracao::Mercadopago {
            if let Some(mapa) = &input.segredos {
                for campo in ["access_token", "public_key"] {
                    let Some(token) = mapa.get(campo).filter(|s| !s.is_empty()) else {
                        continue;
                    };
                    let eh_teste = token.starts_with("TEST-");
                    let eh_prod = token.starts_with("APP_USR-");
                    match (ambiente, eh_teste, eh_prod) {
                        (AmbienteIntegracao::Producao, true, _) => {
                            return Err(DomainError::validacao(format!(
                                "{campo} começa com 'TEST-' — credencial de teste \
                                 na integração de produção."
                            ))
                            .into());
                        }
                        (AmbienteIntegracao::Teste, _, true) => {
                            return Err(DomainError::validacao(format!(
                                "{campo} começa com 'APP_USR-' — credencial de \
                                 produção na integração de teste."
                            ))
                            .into());
                        }
                        _ => {}
                    }
                }
            }
        }

        // Config não-secreta — whitelist por provedor.
        let config = input.config.clone();
        if let Some(c) = &config {
            for chave in c.as_object().map(|o| o.keys()).into_iter().flatten() {
                if !config_permitida(provedor).contains(&chave.as_str()) {
                    return Err(DomainError::validacao(format!(
                        "Chave de config não suportada por {}: {chave}",
                        provedor.as_str()
                    ))
                    .into());
                }
            }
        }

        // Infobip: valores de config validados na escrita — base_url
        // oficial da conta, remetente dentro do alfabeto aceito e
        // teto de segmentos razoável (custo × parte).
        if provedor == ProvedorIntegracao::Infobip {
            if let Some(c) = &config {
                if let Some(base) = c["base_url"].as_str() {
                    clarituz_domain::value_objects::infobip_url::validar_base_url(base)?;
                }
                if let Some(rem) = c["remetente"].as_str() {
                    validar_remetente_sms(rem)?;
                }
                if let Some(n) = c["limite_segmentos"].as_i64() {
                    if !(1..=10).contains(&n) {
                        return Err(DomainError::validacao(
                            "limite_segmentos deve ficar entre 1 e 10.",
                        )
                        .into());
                    }
                }
                if let Some(lista) = c["destinatarios_teste"].as_array() {
                    for d in lista {
                        let ok = d
                            .as_str()
                            .map(|s| {
                                clarituz_domain::value_objects::telefone::normalizar_whatsapp(s)
                                    .is_some()
                            })
                            .unwrap_or(false);
                        if !ok {
                            return Err(DomainError::validacao(
                                "destinatarios_teste: todo item precisa ser E.164 \
                                 ou celular BR (+55...).",
                            )
                            .into());
                        }
                    }
                }
            }
        }

        // Callback assinado por segredo no path — zapi (`webhook_segredo`)
        // e infobip (`webhook_secret`) geram na 1ª gravação; a URL do
        // provedor é o único mecanismo de autenticidade do callback.
        let campo_segredo_auto = match provedor {
            ProvedorIntegracao::Zapi => Some("webhook_segredo"),
            ProvedorIntegracao::Infobip => Some("webhook_secret"),
            _ => None,
        };
        if let Some(campo) = campo_segredo_auto {
            let ja_tem = self
                .repo
                .mapa_segredos(atual.id)
                .await?
                .campos
                .get(campo)
                .copied()
                .unwrap_or(false);
            if !ja_tem && !segredos_enc.contains_key(campo) {
                let segredo = format!(
                    "{}{}",
                    uuid::Uuid::new_v4().simple(),
                    uuid::Uuid::new_v4().simple()
                );
                let enc = self
                    .vault
                    .selar(&contexto_aad(provedor, ambiente, campo, atual.id), &segredo)?;
                segredos_enc.insert(campo.into(), enc);
            }
        }

        let salvo = self
            .repo
            .salvar(
                atual.id,
                versao_esperada,
                &AtualizacaoIntegracao {
                    segredos: None,
                    nome_conta: input.nome_conta.clone(),
                    webhook_url: input.webhook_url.clone(),
                    config,
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
        provedor: ProvedorIntegracao,
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
        provedor: ProvedorIntegracao,
        ambiente: AmbienteIntegracao,
    ) -> AppResult<TesteConexaoOutput> {
        ator.exigir_admin()?;
        let i = self
            .repo
            .buscar(provedor, ambiente)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Integração não configurada."))?;

        // Z-API: teste = GET /status — credencial válida ≠ sessão conectada.
        if provedor == ProvedorIntegracao::Zapi {
            let resultado = match self.com.as_ref() {
                Some(com) => match com.zapi_status().await {
                    Ok(Some(st)) => (
                        StatusVerificacao::Ok,
                        None,
                        st.telefone.or_else(|| {
                            Some(if st.conectado {
                                "sessão conectada".into()
                            } else {
                                "credenciais válidas — aguardando pareamento".into()
                            })
                        }),
                    ),
                    Ok(None) => (
                        StatusVerificacao::Falha,
                        Some("Sem credenciais configuradas para teste.".into()),
                        None,
                    ),
                    Err(e) => (StatusVerificacao::Falha, Some(e.to_string()), None),
                },
                None => (
                    StatusVerificacao::Falha,
                    Some("Resolver de comunicação indisponível.".into()),
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
            return Ok(TesteConexaoOutput {
                verificacao_status: status.as_str().into(),
                nome_conta: conta,
                mensagem: match status {
                    StatusVerificacao::Ok => "Conexão verificada — instância autenticada.".into(),
                    _ => erro
                        .clone()
                        .unwrap_or_else(|| "Falha na verificação.".into()),
                },
            });
        }

        // Spedy: teste = consulta à empresa — leitura, nunca emite.
        if provedor == ProvedorIntegracao::Spedy {
            let resultado = match self.fiscal.as_ref() {
                Some(f) => match f.testar(ator, ambiente).await {
                    Ok(emp) => (
                        StatusVerificacao::Ok,
                        None,
                        emp.razao_social.or(Some(emp.cnpj.unwrap_or(emp.id))),
                    ),
                    Err(e) => (StatusVerificacao::Falha, Some(e.to_string()), None),
                },
                None => (
                    StatusVerificacao::Falha,
                    Some("Serviço fiscal indisponível.".into()),
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
            return Ok(TesteConexaoOutput {
                verificacao_status: status.as_str().into(),
                nome_conta: conta,
                mensagem: match status {
                    StatusVerificacao::Ok => "Conexão verificada — empresa autenticada.".into(),
                    _ => erro
                        .clone()
                        .unwrap_or_else(|| "Falha na verificação.".into()),
                },
            });
        }

        // Didit: teste = leitura autenticada no provedor (destinos de
        // webhook) — nunca cria sessão nem cobra.
        if provedor == ProvedorIntegracao::Didit {
            let resultado = match self.verificacao.as_ref() {
                Some(v) => match v.testar(ambiente).await {
                    Ok(rotulo) => (StatusVerificacao::Ok, None, Some(rotulo)),
                    Err(e) => (StatusVerificacao::Falha, Some(e.to_string()), None),
                },
                None => (
                    StatusVerificacao::Falha,
                    Some("Serviço de verificação indisponível.".into()),
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
            return Ok(TesteConexaoOutput {
                verificacao_status: status.as_str().into(),
                nome_conta: conta,
                mensagem: match status {
                    StatusVerificacao::Ok => "Conexão verificada — conta Didit autenticada.".into(),
                    _ => erro
                        .clone()
                        .unwrap_or_else(|| "Falha na verificação.".into()),
                },
            });
        }

        // Channex: teste = leitura autenticada das propriedades — sem
        // efeito lateral, mesmo com a integração desabilitada.
        if provedor == ProvedorIntegracao::Channex {
            let resultado = match self.distribuicao.as_ref() {
                Some(d) => match d.testar(ambiente).await {
                    Ok(rotulo) => (StatusVerificacao::Ok, None, Some(rotulo)),
                    Err(e) => (StatusVerificacao::Falha, Some(e.to_string()), None),
                },
                None => (
                    StatusVerificacao::Falha,
                    Some("Serviço de distribuição indisponível.".into()),
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
            return Ok(TesteConexaoOutput {
                verificacao_status: status.as_str().into(),
                nome_conta: conta,
                mensagem: match status {
                    StatusVerificacao::Ok => {
                        "Conexão verificada — conta Channex autenticada.".into()
                    }
                    _ => erro
                        .clone()
                        .unwrap_or_else(|| "Falha na verificação.".into()),
                },
            });
        }

        // Infobip: teste = GET /sms/1/logs — leitura autenticada,
        // nunca um envio cobrável.
        if provedor == ProvedorIntegracao::Infobip {
            let resultado = match self.com.as_ref() {
                Some(com) => match com.infobip_testar().await {
                    Ok(Some(rotulo)) => (StatusVerificacao::Ok, None, Some(rotulo)),
                    Ok(None) => (
                        StatusVerificacao::Falha,
                        Some("Sem credenciais configuradas para teste.".into()),
                        None,
                    ),
                    Err(e) => (StatusVerificacao::Falha, Some(e.to_string()), None),
                },
                None => (
                    StatusVerificacao::Falha,
                    Some("Resolver de comunicação indisponível.".into()),
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
            return Ok(TesteConexaoOutput {
                verificacao_status: status.as_str().into(),
                nome_conta: conta,
                mensagem: match status {
                    StatusVerificacao::Ok => {
                        "Conexão verificada — conta Infobip autenticada.".into()
                    }
                    _ => erro
                        .clone()
                        .unwrap_or_else(|| "Falha na verificação.".into()),
                },
            });
        }

        // Teste de conexão é leitura — resolve mesmo com a integração
        // desabilitada (é assim que o operador valida antes de habilitar).
        let resultado = match self.resolver.resolver_historico(provedor, ambiente).await? {
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
        let mut erro = erro;
        // Verificação ok em integração desabilitada — o teste passa,
        // mas o aviso evita confundir "credencial válida" com "no ar".
        if status == StatusVerificacao::Ok && !i.habilitado {
            erro = Some("Credencial válida — integração desabilitada, habilite para usar.".into());
        }
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
                StatusVerificacao::Ok if !i.habilitado => {
                    "Conexão verificada — a integração segue desabilitada, \
                     habilite para operar."
                        .into()
                }
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
        provedor: ProvedorIntegracao,
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
            .definir_padrao(escopo_padrao(provedor), i.id, Some(ator.id))
            .await?;
        info!(provedor = provedor.as_str(), ator = %ator.login, "provedor padrão alterado");
        Ok(())
    }

    pub async fn eventos(
        &self,
        ator: &Ator,
        provedor: ProvedorIntegracao,
        ambiente: AmbienteIntegracao,
        limite: i64,
    ) -> AppResult<Vec<EventoIntegracaoView>> {
        ator.exigir_admin()?;
        let i = self
            .repo
            .buscar(provedor, ambiente)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Integração não configurada."))?;
        // Comunicação: inbox própria; pagamentos: inbox de webhooks.
        if matches!(
            provedor,
            ProvedorIntegracao::Zapi | ProvedorIntegracao::Infobip
        ) {
            let Some(repo) = &self.com_eventos else {
                return Ok(Vec::new());
            };
            return Ok(repo
                .da_integracao(i.id, limite.clamp(1, 100))
                .await?
                .into_iter()
                .map(|e| EventoIntegracaoView {
                    event_id: e.event_id,
                    event_type: e.tipo,
                    status: e.status,
                    ultimo_erro: e.ultimo_erro,
                    recebido_em: e.recebido_em,
                    processado_em: e.processado_em,
                })
                .collect());
        }
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
    ) -> AppResult<Option<(ProvedorIntegracao, AmbienteIntegracao, i64)>> {
        Ok(self.repo.padrao(ESCOPO_PAGAMENTOS_SITE).await?)
    }

    /// Linha crua de uma integração — uso interno dos receptores de
    /// webhook (sem ator nem view). `Some` mesmo desabilitada: o receptor
    /// decide a precedência (persistida governa, env não resgata).
    pub async fn buscar_integracao(
        &self,
        provedor: ProvedorIntegracao,
        ambiente: AmbienteIntegracao,
    ) -> AppResult<Option<Integracao>> {
        Ok(self.repo.buscar(provedor, ambiente).await?)
    }

    pub async fn habilitadas(&self, provedor: ProvedorIntegracao) -> AppResult<Vec<Integracao>> {
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

    // ------------------------------------------------------------------
    // Z-API — operações administrativas da instância (admin-only).
    // ------------------------------------------------------------------

    fn com_resolver(&self) -> AppResult<&Arc<dyn ComunicacaoResolver>> {
        self.com
            .as_ref()
            .ok_or_else(|| DomainError::regra("Resolver de comunicação indisponível.").into())
    }

    /// QR Code de pareamento — imagem base64 ou fluxo assistido.
    pub async fn zapi_qr(&self, ator: &Ator) -> AppResult<serde_json::Value> {
        ator.exigir_admin()?;
        match self.com_resolver()?.zapi_qr().await? {
            ZApiQrView::Imagem(i) => Ok(serde_json::json!({"tipo": "imagem", "valor": i})),
            ZApiQrView::Assistido(h) => Ok(serde_json::json!({"tipo": "assistido", "mensagem": h})),
        }
    }

    /// Registra os 5 callbacks da instância no callback público da API.
    pub async fn zapi_configurar_webhooks(
        &self,
        ator: &Ator,
        api_base: &str,
    ) -> AppResult<serde_json::Value> {
        ator.exigir_admin()?;
        let n = self
            .com_resolver()?
            .zapi_configurar_webhooks(api_base)
            .await?;
        info!(callbacks = n, ator = %ator.login, "zapi: webhooks configurados");
        Ok(serde_json::json!({"callbacks_configurados": n}))
    }

    /// Logout remoto — só por ação explícita do operador.
    pub async fn zapi_desconectar(&self, ator: &Ator) -> AppResult<()> {
        ator.exigir_admin()?;
        self.com_resolver()?.zapi_desconectar().await?;
        info!(ator = %ator.login, "zapi: sessão desconectada");
        Ok(())
    }

    /// Mensagem de teste única — fora da fila, sem retry automático.
    pub async fn zapi_enviar_teste(
        &self,
        ator: &Ator,
        input: &MensagemTesteInput,
    ) -> AppResult<serde_json::Value> {
        ator.exigir_admin()?;
        let digitos: String = input
            .telefone
            .chars()
            .filter(char::is_ascii_digit)
            .collect();
        if digitos.len() < 10 || digitos.len() > 15 {
            return Err(DomainError::validacao("Telefone inválido — envie com DDI+DDD.").into());
        }
        let texto = input
            .texto
            .as_deref()
            .unwrap_or("Teste de integração Z-API — Pousada Espírito do Mar. Pode ignorar.");
        let msgid = self
            .com_resolver()?
            .zapi_enviar_direto(&digitos, texto)
            .await?;
        info!(ator = %ator.login, "zapi: mensagem de teste enviada");
        Ok(serde_json::json!({"enviado": true, "id_provedor": msgid}))
    }

    // ------------------------------------------------------------------
    // Infobip — SMS de teste fora da fila, destinatário preso à
    // allowlist `destinatarios_teste` da config (lista vazia = qualquer
    // número — ação admin explícita, registrada em log).
    // ------------------------------------------------------------------

    pub async fn infobip_enviar_teste(
        &self,
        ator: &Ator,
        input: &MensagemTesteInput,
    ) -> AppResult<serde_json::Value> {
        ator.exigir_admin()?;
        let com = self.com_resolver()?;
        let digitos: String = input
            .telefone
            .chars()
            .filter(char::is_ascii_digit)
            .collect();
        if digitos.len() < 10 || digitos.len() > 15 {
            return Err(DomainError::validacao("Telefone inválido — envie com DDI+DDD.").into());
        }
        if let Some(i) = com.integracao_infobip().await? {
            if let Some(lista) = i.config["destinatarios_teste"].as_array() {
                if !lista.is_empty() {
                    let permitido = lista.iter().filter_map(|v| v.as_str()).any(|d| {
                        let d: String = d.chars().filter(char::is_ascii_digit).collect();
                        !d.is_empty() && (d == digitos || digitos.ends_with(&d))
                    });
                    if !permitido {
                        return Err(DomainError::regra(
                            "Destino fora da allowlist de teste — adicione o número \
                             em destinatarios_teste ou esvazie a lista.",
                        )
                        .into());
                    }
                }
            }
        }
        let texto = input
            .texto
            .as_deref()
            .unwrap_or("Teste de integração Infobip — Pousada Espírito do Mar. Pode ignorar.");
        let msgid = com.infobip_enviar_teste(&digitos, texto).await?;
        info!(ator = %ator.login, "infobip: SMS de teste enviado");
        Ok(serde_json::json!({"enviado": msgid.is_some(), "id_provedor": msgid}))
    }
}
