//! Serviço de verificação de identidade (KYC) de funcionários — Didit.
//!
//! Orquestra: sessão hospedada por funcionário (uma viva por vez, o link é
//! reutilizado), consulta da decisão, ingestão de webhook assinado com
//! dedup por `event_id`, e o portão de login — quando a integração de
//! produção está habilitada com `exigir_verificacao`, funcionários não
//! verificados ficam bloqueados até aprovar o KYC (admin mantém bypass
//! de emergência para nunca trancar todo mundo para fora).
//!
//! Regras observadas:
//! - `status_remoto` é preservado cru; o mapeamento é explícito e um
//!   status desconhecido nunca vira "aprovada".
//! - Sessões de teste (ambiente `teste`) nunca bloqueiam login — o portão
//!   olha apenas para a integração de produção.
//! - Webhook é persistido antes de processar; ordem de entrega não é
//!   garantida, então status terminal nunca regride.

use std::sync::Arc;

use serde::Serialize;
use tracing::{info, warn};

use clarituz_domain::entities::{
    AmbienteIntegracao, Integracao, ProvedorIntegracao, StatusVerificacaoIdentidade,
    VerificacaoIdentidade, VerificacaoListItem,
};
use clarituz_domain::ports::{
    CredentialVault, FuncionarioRepository, IntegracaoRepository, NovaVerificacao,
    ProvedorVerificacao, VerificacaoRepository,
};
use clarituz_domain::DomainError;
use clarituz_shared::{Page, PageParams};

use crate::actor::Ator;
use crate::error::AppResult;

/// Fábrica do cliente Didit — a application não conhece reqwest; a infra
/// injeta a closure que constrói `Arc<dyn ProvedorVerificacao>` da chave.
pub type DiditFactory = Arc<dyn Fn(String) -> Arc<dyn ProvedorVerificacao> + Send + Sync>;

#[derive(Debug, Serialize)]
#[allow(clippy::struct_excessive_bools)]
pub struct MinhaVerificacao {
    pub status: String,
    pub rotulo: String,
    /// URL da sessão viva — quando existe, o usuário pode abrir/continuar.
    pub url: Option<String>,
    /// A integração de produção exige verificação para liberar o sistema.
    pub exigido: bool,
    /// `exigido && !aprovada` — frontend bloqueia a navegação.
    pub bloqueado: bool,
    /// Admin (nível 1) pode seguir mesmo bloqueado — bypass de emergência
    /// para nunca trancar todo mundo para fora do painel.
    pub admin: bool,
    pub aprovada: bool,
}

#[derive(Debug, Serialize)]
pub struct SessaoView {
    pub id: uuid::Uuid,
    pub session_id: String,
    pub url: String,
    pub status: String,
    pub rotulo: String,
    /// `true` quando reaproveitou a sessão viva em vez de criar outra.
    pub reutilizada: bool,
}

#[derive(Debug)]
pub enum ResultadoWebhook {
    Processado,
    Duplicado,
    SessaoDesconhecida,
}

pub struct VerificacaoService {
    repo: Arc<dyn VerificacaoRepository>,
    integracoes: Arc<dyn IntegracaoRepository>,
    funcionarios: Arc<dyn FuncionarioRepository>,
    vault: Arc<dyn CredentialVault>,
    factory: DiditFactory,
}

impl VerificacaoService {
    pub fn new(
        repo: Arc<dyn VerificacaoRepository>,
        integracoes: Arc<dyn IntegracaoRepository>,
        funcionarios: Arc<dyn FuncionarioRepository>,
        vault: Arc<dyn CredentialVault>,
        factory: DiditFactory,
    ) -> Self {
        Self {
            repo,
            integracoes,
            funcionarios,
            vault,
            factory,
        }
    }

    // -- resolução da integração + cliente autenticado -------------------

    async fn integracao(&self, ambiente: AmbienteIntegracao) -> AppResult<Integracao> {
        self.integracoes
            .buscar(ProvedorIntegracao::Didit, ambiente)
            .await?
            .ok_or_else(|| DomainError::regra("Didit não configurada neste ambiente.").into())
    }

    fn cfg<'a>(integ: &'a Integracao, campo: &str) -> Option<&'a str> {
        integ.config[campo].as_str().filter(|s| !s.is_empty())
    }

    fn cfg_bool(integ: &Integracao, campo: &str) -> bool {
        integ.config[campo].as_bool().unwrap_or(false)
    }

    fn segredo_aberto(
        &self,
        integ: &Integracao,
        campo: &str,
        envelopes: &std::collections::HashMap<String, Vec<u8>>,
    ) -> AppResult<Option<String>> {
        match envelopes.get(campo) {
            Some(env) => Ok(Some(self.vault.abrir(
                &contexto_aad(integ.provedor, integ.ambiente, campo, integ.id),
                env,
            )?)),
            None => Ok(None),
        }
    }

    async fn cliente(
        &self,
        ambiente: AmbienteIntegracao,
        exigir_habilitada: bool,
    ) -> AppResult<(Integracao, Arc<dyn ProvedorVerificacao>)> {
        let integ = self.integracao(ambiente).await?;
        if exigir_habilitada && !integ.habilitado {
            return Err(DomainError::regra(
                "Integração Didit desativada — habilite para criar verificações.",
            )
            .into());
        }
        let enc = self.integracoes.segredos_enc(integ.id).await?;
        let Some(api_key) = self.segredo_aberto(&integ, "api_key", &enc)? else {
            return Err(DomainError::regra("Didit sem chave de API configurada.").into());
        };
        Ok((integ, (self.factory)(api_key)))
    }

    async fn segredo_webhook(&self, integ: &Integracao) -> AppResult<Option<String>> {
        let enc = self.integracoes.segredos_enc(integ.id).await?;
        self.segredo_aberto(integ, "webhook_secret", &enc)
    }

    /// Teste de conexão do card de integração — leitura autenticada sem
    /// efeito lateral, funciona com a integração desabilitada (é assim que
    /// o operador valida a chave antes de habilitar).
    pub async fn testar(&self, ambiente: AmbienteIntegracao) -> AppResult<String> {
        let (_, cli) = self.cliente(ambiente, false).await?;
        Ok(cli.testar().await?)
    }

    // -- portão de login --------------------------------------------------

    /// Status do funcionário autenticado + regra do portão. O gate usa
    /// somente a integração de **produção** — sandbox nunca bloqueia login.
    pub async fn minha(&self, ator: &Ator) -> AppResult<MinhaVerificacao> {
        let integ = self
            .integracoes
            .buscar(ProvedorIntegracao::Didit, AmbienteIntegracao::Producao)
            .await?;
        let exigido = integ
            .as_ref()
            .is_some_and(|i| i.habilitado && Self::cfg_bool(i, "exigir_verificacao"));

        let v = match &integ {
            Some(i) => self.repo.atual(ator.id, i.id).await?,
            None => None,
        };
        let (status, url) = match &v {
            Some(v) => (
                v.status_enum(),
                (!v.status_enum().terminal()).then(|| v.url.clone()),
            ),
            None => (StatusVerificacaoIdentidade::NaoIniciada, None),
        };
        let aprovada = status.aprovada();
        let bloqueado = exigido && !aprovada;
        Ok(MinhaVerificacao {
            status: status.as_str().into(),
            rotulo: status.rotulo().into(),
            url,
            exigido,
            bloqueado,
            admin: ator.is_admin(),
            aprovada,
        })
    }

    /// Portão por requisição — chamado pelo extractor `Ator`. Ordem:
    /// admin → libera sempre (bypass de emergência, sem consulta);
    /// integração ausente/desabilitada/`exigir_verificacao` off → libera;
    /// senão, só a última verificação `aprovada` libera.
    ///
    /// Falha de infraestrutura (banco indisponível) **não** pode derrubar
    /// o painel inteiro — fail-open com log; o portão volta a valer na
    /// próxima requisição.
    pub async fn acesso_permitido(&self, funcionario_id: i64, admin: bool) -> bool {
        if admin {
            return true;
        }
        let res: Result<bool, DomainError> = async {
            let Some(i) = self
                .integracoes
                .buscar(ProvedorIntegracao::Didit, AmbienteIntegracao::Producao)
                .await?
            else {
                return Ok(true);
            };
            if !(i.habilitado && Self::cfg_bool(&i, "exigir_verificacao")) {
                return Ok(true);
            }
            let v = self.repo.atual(funcionario_id, i.id).await?;
            Ok(v.is_some_and(|v| v.status_enum().aprovada()))
        }
        .await;
        match res {
            Ok(ok) => ok,
            Err(e) => {
                warn!(erro = %e, "didit: falha no portão de login — liberando em degrade");
                true
            }
        }
    }

    /// Sessão self-service do funcionário autenticado (portão de login) —
    /// sempre na integração de produção.
    pub async fn minha_sessao(&self, ator: &Ator) -> AppResult<SessaoView> {
        self.sessao_para_funcionario(ator.id, AmbienteIntegracao::Producao)
            .await
    }

    /// Admin cria/recupera a sessão de um funcionário para enviar o link
    /// (WhatsApp/e-mail) — gerencial+, ambiente escolhido.
    pub async fn sessao_para(
        &self,
        ator: &Ator,
        funcionario_id: i64,
        ambiente: AmbienteIntegracao,
    ) -> AppResult<SessaoView> {
        ator.exigir_gerencial()?;
        self.sessao_para_funcionario(funcionario_id, ambiente).await
    }

    async fn sessao_para_funcionario(
        &self,
        funcionario_id: i64,
        ambiente: AmbienteIntegracao,
    ) -> AppResult<SessaoView> {
        let func = self
            .funcionarios
            .buscar(funcionario_id)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Funcionário não encontrado."))?;
        if !func.ativo {
            return Err(DomainError::regra("Funcionário inativo.").into());
        }
        let (integ, cli) = self.cliente(ambiente, true).await?;
        let workflow = Self::cfg(&integ, "workflow_id").ok_or_else(|| {
            DomainError::regra("Configure o workflow_id da Didit antes de criar verificações.")
        })?;

        if let Some(viva) = self.repo.viva(funcionario_id, integ.id).await? {
            let st = viva.status_enum();
            return Ok(SessaoView {
                id: viva.id,
                session_id: viva.session_id,
                url: viva.url,
                status: st.as_str().into(),
                rotulo: st.rotulo().into(),
                reutilizada: true,
            });
        }

        let vendor_data = format!("func-{}", func.id);
        let callback = Self::cfg(&integ, "callback_url");
        let sess = cli.criar_sessao(workflow, &vendor_data, callback).await?;

        let row = match self
            .repo
            .criar(&NovaVerificacao {
                integracao_id: integ.id,
                funcionario_id,
                session_id: sess.session_id.clone(),
                url: sess.url.clone(),
                vendor_data,
            })
            .await
        {
            Ok(r) => r,
            // corrida: outro pedido criou a sessão viva primeiro —
            // devolve a existente em vez de falhar.
            Err(e) => match self.repo.viva(funcionario_id, integ.id).await {
                Ok(Some(v)) => v,
                _ => return Err(e.into()),
            },
        };

        let st = row.status_enum();
        Ok(SessaoView {
            id: row.id,
            session_id: row.session_id,
            url: row.url,
            status: st.as_str().into(),
            rotulo: st.rotulo().into(),
            reutilizada: false,
        })
    }

    /// Status de um funcionário (visão gerencial — badge na tela de equipe).
    pub async fn status_funcionario(
        &self,
        ator: &Ator,
        funcionario_id: i64,
        ambiente: AmbienteIntegracao,
    ) -> AppResult<serde_json::Value> {
        ator.exigir_gerencial()?;
        let integ = self.integracao(ambiente).await?;
        let v = self.repo.atual(funcionario_id, integ.id).await?;
        Ok(match v {
            Some(v) => {
                let st = v.status_enum();
                serde_json::json!({
                    "status": st.as_str(),
                    "rotulo": st.rotulo(),
                    "aprovada": st.aprovada(),
                    "terminal": st.terminal(),
                    "url": (!st.terminal()).then(|| v.url.clone()),
                    "atualizado_em": v.atualizado_em,
                })
            }
            None => serde_json::json!({
                "status": "sem_verificacao",
                "rotulo": "Sem verificação",
                "aprovada": false,
                "terminal": false,
            }),
        })
    }

    pub async fn listar(
        &self,
        ator: &Ator,
        page: PageParams,
        ambiente: AmbienteIntegracao,
    ) -> AppResult<Page<VerificacaoListItem>> {
        ator.exigir_gerencial()?;
        let integ = self.integracao(ambiente).await?;
        Ok(self.repo.listar(page, integ.id).await?)
    }

    /// Puxa a decisão remota e aplica — mesmo mapeamento do webhook.
    pub async fn sincronizar(
        &self,
        ator: &Ator,
        id: uuid::Uuid,
    ) -> AppResult<VerificacaoIdentidade> {
        ator.exigir_gerencial()?;
        let v = self
            .repo
            .por_id(id)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Verificação não encontrada."))?;
        let integ = self
            .integracoes
            .buscar_por_id(v.integracao_id)
            .await?
            .ok_or_else(|| DomainError::regra("Integração removida."))?;
        let (_, cli) = self.cliente(integ.ambiente, false).await?;
        let decisao = cli.decisao(&v.session_id).await?;
        self.aplicar_remoto(&v, &decisao.status, Some(&decisao.resumo))
            .await?;
        Ok(self
            .repo
            .por_id(id)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Verificação não encontrada."))?)
    }

    /// Registra o destino de webhook na Didit e guarda o
    /// `secret_shared_key` cifrado como `webhook_secret`.
    pub async fn configurar_webhook(
        &self,
        ator: &Ator,
        ambiente: AmbienteIntegracao,
        base_publica: &str,
    ) -> AppResult<String> {
        ator.exigir_admin()?;
        let (integ, cli) = self.cliente(ambiente, false).await?;
        let url = format!(
            "{}/api/v1/webhooks/didit/{}",
            base_publica.trim_end_matches('/'),
            ambiente.as_str()
        );
        let destino = cli.registrar_destino(&url).await?;
        let enc = self.vault.selar(
            &contexto_aad(integ.provedor, integ.ambiente, "webhook_secret", integ.id),
            &destino.secret_shared_key,
        )?;
        let mut mapa = std::collections::HashMap::new();
        mapa.insert("webhook_secret".to_string(), enc);
        self.integracoes
            .salvar(
                integ.id,
                integ.versao,
                &clarituz_domain::ports::AtualizacaoIntegracao {
                    segredos: None,
                    nome_conta: None,
                    webhook_url: Some(url.clone()),
                    config: None,
                },
                &mapa,
                Some(ator.id),
            )
            .await?;
        self.integracoes
            .mesclar_config(
                integ.id,
                &serde_json::json!({
                    "webhook_registrado": true,
                    "webhook_destino_id": destino.id,
                }),
            )
            .await?;
        info!(integracao = integ.id, "didit: webhook registrado");
        Ok(url)
    }

    /// Configuração operacional da integração — valida antes de ligar o
    /// portão (`exigir_verificacao` exige workflow configurado).
    pub async fn configurar(
        &self,
        ator: &Ator,
        ambiente: AmbienteIntegracao,
        workflow_id: Option<String>,
        callback_url: Option<String>,
        exigir_verificacao: bool,
    ) -> AppResult<()> {
        ator.exigir_admin()?;
        let integ = self.integracao(ambiente).await?;
        let workflow = workflow_id.unwrap_or_default();
        if exigir_verificacao && workflow.is_empty() {
            return Err(DomainError::validacao(
                "Configure o workflow_id antes de exigir verificação no login.",
            )
            .into());
        }
        self.integracoes
            .mesclar_config(
                integ.id,
                &serde_json::json!({
                    "workflow_id": workflow,
                    "callback_url": callback_url.unwrap_or_default(),
                    "exigir_verificacao": exigir_verificacao,
                }),
            )
            .await?;
        Ok(())
    }

    // -- webhook ----------------------------------------------------------

    pub async fn webhook_secret(&self, ambiente: AmbienteIntegracao) -> AppResult<Option<String>> {
        let integ = self.integracao(ambiente).await?;
        self.segredo_webhook(&integ).await
    }

    /// Envelope Didit: `event_id`, `session_id`, `status`, `webhook_type`,
    /// `vendor_data`, `decision`. Persiste antes de processar; dedup por
    /// `event_id`; status terminal nunca regride para não-terminal.
    pub async fn webhook_receber(
        &self,
        payload: &serde_json::Value,
    ) -> AppResult<ResultadoWebhook> {
        let event_id = payload["event_id"].as_str().unwrap_or("").to_string();
        if event_id.is_empty() {
            return Err(DomainError::validacao("webhook sem event_id").into());
        }
        let session_id = payload["session_id"]
            .as_str()
            .map(std::string::ToString::to_string);
        let webhook_type = payload["webhook_type"]
            .as_str()
            .map(std::string::ToString::to_string);

        let novo = self
            .repo
            .inbox_inserir(
                &event_id,
                session_id.as_deref(),
                webhook_type.as_deref(),
                payload,
            )
            .await?;
        if !novo {
            return Ok(ResultadoWebhook::Duplicado);
        }

        let resultado = self.processar_evento(payload, session_id.as_deref()).await;
        match resultado {
            Ok(r) => {
                let _ = self.repo.inbox_marcar_processado(&event_id).await;
                Ok(r)
            }
            Err(e) => Err(e),
        }
    }

    async fn processar_evento(
        &self,
        payload: &serde_json::Value,
        session_id: Option<&str>,
    ) -> AppResult<ResultadoWebhook> {
        let Some(session_id) = session_id else {
            warn!("didit webhook: evento sem session_id — ignorado");
            return Ok(ResultadoWebhook::SessaoDesconhecida);
        };
        let Some(v) = self.repo.por_session(session_id).await? else {
            warn!(session_id, "didit webhook: sessão desconhecida");
            return Ok(ResultadoWebhook::SessaoDesconhecida);
        };
        let remoto = payload["status"].as_str().unwrap_or("");
        self.aplicar_remoto(&v, remoto, payload.get("decision"))
            .await?;
        Ok(ResultadoWebhook::Processado)
    }

    /// Aplica a visão remota — mapeamento explícito, sem regressão de
    /// status terminal para não-terminal (entrega fora de ordem).
    async fn aplicar_remoto(
        &self,
        v: &VerificacaoIdentidade,
        status_remoto: &str,
        resumo: Option<&serde_json::Value>,
    ) -> AppResult<()> {
        let atual = v.status_enum();
        let novo = StatusVerificacaoIdentidade::do_remoto(status_remoto);
        match novo {
            None => {
                warn!(
                    status_remoto,
                    "didit: status remoto desconhecido — preservado"
                );
                self.repo
                    .atualizar_status(
                        v.id,
                        StatusVerificacaoIdentidade::Desconhecido.as_str(),
                        Some(status_remoto),
                        resumo.unwrap_or(&serde_json::json!({})),
                        false,
                    )
                    .await?;
            }
            Some(n) if atual.terminal() && !n.terminal() => {
                info!(
                    status_remoto,
                    "didit: evento fora de ordem ignorado — sessão já encerrada"
                );
            }
            Some(n) => {
                self.repo
                    .atualizar_status(
                        v.id,
                        n.as_str(),
                        Some(status_remoto),
                        resumo.unwrap_or(&serde_json::json!({})),
                        n.terminal(),
                    )
                    .await?;
                if n.aprovada() {
                    info!(
                        funcionario = v.funcionario_id,
                        "didit: identidade verificada"
                    );
                }
            }
        }
        Ok(())
    }
}

fn contexto_aad(p: ProvedorIntegracao, a: AmbienteIntegracao, campo: &str, id: i64) -> String {
    format!("{}|{}|{campo}|{id}", p.as_str(), a.as_str())
}
