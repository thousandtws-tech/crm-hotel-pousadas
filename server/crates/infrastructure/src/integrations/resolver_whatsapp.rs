use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use tokio::sync::RwLock;

use chrono::Utc;
use clarituz_domain::entities::{AmbienteIntegracao, Integracao, ProvedorIntegracao};
use clarituz_domain::enums::CanalEnvio;
use clarituz_domain::error::DomainError;
use clarituz_domain::ports::{
    ComunicacaoResolver, CredenciaisInfobip, CredenciaisZApi, CredentialVault, Emissor,
    EmissorResolvido, IntegracaoRepository, ZApiQrView, ZApiStatusView,
};

use super::infobip::{InfobipCliente, InfobipCredenciais, InfobipEmissor};
use super::resolver::contexto_aad;
use super::zapi::{ZApiCliente, ZApiCredenciais, ZApiEmissor, ZApiQr};

const ESCOPO_WHATSAPP: &str = "whatsapp";
const ESCOPO_SMS: &str = "sms";

type CacheEmissor = (i64, i32, Arc<dyn Emissor>);

pub struct PgComunicacaoResolver {
    repo: Arc<dyn IntegracaoRepository>,
    vault: Arc<dyn CredentialVault>,
    legados: Vec<Arc<dyn Emissor>>,
    cache: RwLock<Option<CacheEmissor>>,
    cache_sms: RwLock<Option<CacheEmissor>>,
}

impl PgComunicacaoResolver {
    pub fn new(
        repo: Arc<dyn IntegracaoRepository>,
        vault: Arc<dyn CredentialVault>,
        legados: Vec<Arc<dyn Emissor>>,
    ) -> Self {
        Self {
            repo,
            vault,
            legados,
            cache: RwLock::new(None),
            cache_sms: RwLock::new(None),
        }
    }

    fn legado(&self, provedor: &str) -> Option<Arc<dyn Emissor>> {
        self.legados
            .iter()
            .find(|e| e.canal() == CanalEnvio::Whatsapp && e.provedor() == provedor)
            .cloned()
    }

    fn primeiro_legado(&self) -> Option<Arc<dyn Emissor>> {
        self.legados
            .iter()
            .find(|e| e.canal() == CanalEnvio::Whatsapp)
            .cloned()
    }

    async fn segredos_abertos(
        &self,
        integ: &Integracao,
    ) -> Result<HashMap<String, String>, DomainError> {
        let enc = self.repo.segredos_enc(integ.id).await?;
        let mut abertos = HashMap::new();
        for (campo, envelope) in enc {
            let v = self.vault.abrir(
                &contexto_aad(integ.provedor, integ.ambiente, &campo, integ.id),
                &envelope,
            )?;
            abertos.insert(campo, v);
        }
        Ok(abertos)
    }

    async fn credenciais_zapi(
        &self,
        exigir_habilitada: bool,
    ) -> Result<Option<(i64, ZApiCredenciais)>, DomainError> {
        let Some(integ) = self
            .repo
            .buscar(ProvedorIntegracao::Zapi, AmbienteIntegracao::Producao)
            .await?
        else {
            return Ok(None);
        };
        if exigir_habilitada && !integ.habilitado {
            return Ok(None);
        }
        let instance_id = integ.config["instance_id"].as_str().unwrap_or_default();
        if instance_id.is_empty() {
            return Ok(None);
        }
        let s = self.segredos_abertos(&integ).await?;
        let (Some(tok), Some(cli)) = (s.get("instance_token"), s.get("client_token")) else {
            return Ok(None);
        };
        Ok(Some((
            integ.id,
            ZApiCredenciais {
                instance_id: instance_id.to_string(),
                instance_token: tok.clone(),
                client_token: cli.clone(),
            },
        )))
    }

    async fn emissor_zapi(&self) -> Result<Option<EmissorResolvido>, DomainError> {
        let Some((idintegracao, cred)) = self.credenciais_zapi(true).await? else {
            return Ok(None);
        };
        let Some(integ) = self.repo.buscar_por_id(idintegracao).await? else {
            return Ok(None);
        };
        {
            let cache = self.cache.read().await;
            if let Some((id, v, em)) = cache.as_ref() {
                if *id == integ.id && *v == integ.versao {
                    return Ok(Some(EmissorResolvido {
                        provedor: "zapi".into(),
                        idintegracao: Some(integ.id),
                        emissor: em.clone(),
                    }));
                }
            }
        }
        let em: Arc<dyn Emissor> = Arc::new(ZApiEmissor::new(cred));
        *self.cache.write().await = Some((integ.id, integ.versao, em.clone()));
        Ok(Some(EmissorResolvido {
            provedor: "zapi".into(),
            idintegracao: Some(integ.id),
            emissor: em,
        }))
    }

    // --------------------------------------------------------------
    // Infobip (SMS) — mesma mecânica: config + cofre → credenciais,
    // emissor cacheado por (id, versao).

    async fn credenciais_infobip(
        &self,
        exigir_habilitada: bool,
    ) -> Result<Option<CredenciaisInfobip>, DomainError> {
        let Some(integ) = self
            .repo
            .buscar(ProvedorIntegracao::Infobip, AmbienteIntegracao::Producao)
            .await?
        else {
            return Ok(None);
        };
        if exigir_habilitada && !integ.habilitado {
            return Ok(None);
        }
        if integ.config["envio_pausado"].as_bool().unwrap_or(false) && exigir_habilitada {
            return Ok(None);
        }
        let base_url = integ.config["base_url"].as_str().unwrap_or_default();
        let remetente = integ.config["remetente"].as_str().unwrap_or_default();
        if base_url.is_empty() || remetente.is_empty() {
            return Ok(None);
        }
        let limite = integ.config["limite_segmentos"].as_i64().unwrap_or(3) as i32;
        let s = self.segredos_abertos(&integ).await?;
        let Some(key) = s.get("api_key") else {
            return Ok(None);
        };
        Ok(Some(CredenciaisInfobip {
            idintegracao: integ.id,
            base_url: base_url.to_string(),
            api_key: key.clone(),
            remetente: remetente.to_string(),
            limite_segmentos: limite,
            callback_url: integ.config["callback_url"].as_str().map(str::to_string),
        }))
    }

    async fn emissor_infobip(&self) -> Result<Option<EmissorResolvido>, DomainError> {
        let Some(c) = self.credenciais_infobip(true).await? else {
            return Ok(None);
        };
        let Some(integ) = self.repo.buscar_por_id(c.idintegracao).await? else {
            return Ok(None);
        };
        {
            let cache = self.cache_sms.read().await;
            if let Some((id, v, em)) = cache.as_ref() {
                if *id == integ.id && *v == integ.versao {
                    return Ok(Some(EmissorResolvido {
                        provedor: "infobip".into(),
                        idintegracao: Some(integ.id),
                        emissor: em.clone(),
                    }));
                }
            }
        }
        let em: Arc<dyn Emissor> = Arc::new(InfobipEmissor::new(&c));
        *self.cache_sms.write().await = Some((integ.id, integ.versao, em.clone()));
        Ok(Some(EmissorResolvido {
            provedor: "infobip".into(),
            idintegracao: Some(integ.id),
            emissor: em,
        }))
    }
}

#[async_trait]
impl ComunicacaoResolver for PgComunicacaoResolver {
    async fn whatsapp(&self, provedor: Option<&str>) -> Result<EmissorResolvido, DomainError> {
        if let Some(p) = provedor {
            if p == "zapi" {
                return self.emissor_zapi().await?.ok_or_else(|| {
                    DomainError::regra("zapi: integração desabilitada ou sem credenciais")
                });
            }
            return self
                .legado(p)
                .map(|emissor| EmissorResolvido {
                    provedor: p.to_string(),
                    idintegracao: None,
                    emissor,
                })
                .ok_or_else(|| {
                    DomainError::regra(format!("whatsapp: provedor '{p}' não configurado"))
                });
        }

        if let Some((p, _, idint)) = self.repo.padrao(ESCOPO_WHATSAPP).await? {
            if p == ProvedorIntegracao::Zapi {
                if let Some(r) = self.emissor_zapi().await? {
                    return Ok(r);
                }
                return Err(DomainError::regra(
                    "zapi: padrão WhatsApp sem credenciais válidas",
                ));
            }
            if let Some(emissor) = self.legado(p.as_str()) {
                return Ok(EmissorResolvido {
                    provedor: p.as_str().into(),
                    idintegracao: Some(idint),
                    emissor,
                });
            }
        }

        if let Some(r) = self.emissor_zapi().await? {
            return Ok(r);
        }

        if let Some(emissor) = self.primeiro_legado() {
            return Ok(EmissorResolvido {
                provedor: emissor.provedor().into(),
                idintegracao: None,
                emissor,
            });
        }

        Err(DomainError::regra(
            "canal whatsapp sem provedor configurado",
        ))
    }

    async fn integracao_zapi(&self) -> Result<Option<Integracao>, DomainError> {
        self.repo
            .buscar(ProvedorIntegracao::Zapi, AmbienteIntegracao::Producao)
            .await
    }

    async fn segredo_zapi(&self, campo: &str) -> Result<Option<String>, DomainError> {
        let Some(integ) = self.integracao_zapi().await? else {
            return Ok(None);
        };
        let enc = self.repo.segredos_enc(integ.id).await?;
        match enc.get(campo) {
            Some(env) => Ok(Some(self.vault.abrir(
                &contexto_aad(ProvedorIntegracao::Zapi, integ.ambiente, campo, integ.id),
                env,
            )?)),
            None => Ok(None),
        }
    }

    async fn credenciais_zapi_abertas(&self) -> Result<Option<CredenciaisZApi>, DomainError> {
        Ok(self
            .credenciais_zapi(false)
            .await?
            .map(|(id, c)| CredenciaisZApi {
                idintegracao: id,
                instance_id: c.instance_id,
                instance_token: c.instance_token,
                client_token: c.client_token,
            }))
    }

    async fn zapi_status(&self) -> Result<Option<ZApiStatusView>, DomainError> {
        let Some(c) = self.credenciais_zapi_abertas().await? else {
            return Ok(None);
        };
        let cli = ZApiCliente::new(ZApiCredenciais {
            instance_id: c.instance_id,
            instance_token: c.instance_token,
            client_token: c.client_token,
        });
        let st = cli.status().await?;
        let telefone = if st.conectado {
            cli.telefone().await.ok().flatten().or(st.telefone)
        } else {
            st.telefone
        };
        self.repo
            .mesclar_config(
                c.idintegracao,
                &serde_json::json!({
                    "sessao": {
                        "conectado": st.conectado,
                        "smartphone_conectado": st.smartphone_conectado,
                        "telefone": telefone,
                        "verificado_em": Utc::now(),
                    }
                }),
            )
            .await?;
        Ok(Some(ZApiStatusView {
            conectado: st.conectado,
            smartphone_conectado: st.smartphone_conectado,
            telefone,
            detalhe: st.detalhe,
        }))
    }

    async fn zapi_qr(&self) -> Result<ZApiQrView, DomainError> {
        let Some(c) = self.credenciais_zapi_abertas().await? else {
            return Err(DomainError::regra("zapi: credenciais não configuradas"));
        };
        let cli = ZApiCliente::new(ZApiCredenciais {
            instance_id: c.instance_id,
            instance_token: c.instance_token,
            client_token: c.client_token,
        });
        Ok(match cli.qr_code().await? {
            ZApiQr::Imagem(i) => ZApiQrView::Imagem(i),
            ZApiQr::Assistido(h) => ZApiQrView::Assistido(h),
        })
    }

    async fn zapi_configurar_webhooks(&self, callback_base: &str) -> Result<usize, DomainError> {
        let Some(c) = self.credenciais_zapi_abertas().await? else {
            return Err(DomainError::regra("zapi: credenciais não configuradas"));
        };
        let Some(segredo) = self.segredo_zapi("webhook_segredo").await? else {
            return Err(DomainError::regra(
                "zapi: segredo de callback ausente — salve a configuração primeiro",
            ));
        };
        let cli = ZApiCliente::new(ZApiCredenciais {
            instance_id: c.instance_id,
            instance_token: c.instance_token,
            client_token: c.client_token,
        });
        let url = format!(
            "{}/api/v1/webhooks/zapi/{segredo}",
            callback_base.trim_end_matches('/')
        );
        let mut ok = 0usize;
        for op in [
            "received",
            "delivery",
            "message-status",
            "connected",
            "disconnected",
        ] {
            cli.update_webhook(op, &url).await?;
            ok += 1;
        }
        self.repo
            .mesclar_config(
                c.idintegracao,
                &serde_json::json!({"webhooks_configurados": ok}),
            )
            .await?;
        Ok(ok)
    }

    async fn zapi_desconectar(&self) -> Result<(), DomainError> {
        let Some(c) = self.credenciais_zapi_abertas().await? else {
            return Err(DomainError::regra("zapi: credenciais não configuradas"));
        };
        let cli = ZApiCliente::new(ZApiCredenciais {
            instance_id: c.instance_id,
            instance_token: c.instance_token,
            client_token: c.client_token,
        });
        cli.desconectar().await?;
        self.repo
            .mesclar_config(
                c.idintegracao,
                &serde_json::json!({"sessao": {"conectado": false}}),
            )
            .await?;
        Ok(())
    }

    async fn zapi_enviar_direto(
        &self,
        telefone: &str,
        mensagem: &str,
    ) -> Result<Option<String>, DomainError> {
        let Some(c) = self.credenciais_zapi_abertas().await? else {
            return Err(DomainError::regra("zapi: credenciais não configuradas"));
        };
        let cli = ZApiCliente::new(ZApiCredenciais {
            instance_id: c.instance_id,
            instance_token: c.instance_token,
            client_token: c.client_token,
        });
        let resp = cli.send_text(telefone, mensagem).await?;
        Ok(resp["id"].as_str().map(str::to_string))
    }

    // --------------------------------------------------------------
    // SMS / Infobip

    async fn sms(&self, _provedor: Option<&str>) -> Result<EmissorResolvido, DomainError> {
        // Padrão declarado no catálogo — hoje só existe infobip; um
        // padrão apontando pra outro provedor falha explícito em vez
        // de enviar pelo caminho errado.
        if let Some((p, _, _)) = self.repo.padrao(ESCOPO_SMS).await? {
            if p != ProvedorIntegracao::Infobip {
                return Err(DomainError::regra(format!(
                    "sms: provedor padrão '{}' sem implementação",
                    p.as_str()
                )));
            }
        }
        if let Some(r) = self.emissor_infobip().await? {
            return Ok(r);
        }
        Err(DomainError::regra(
            "canal sms sem provedor configurado — cadastre a integração Infobip",
        ))
    }

    async fn integracao_infobip(&self) -> Result<Option<Integracao>, DomainError> {
        self.repo
            .buscar(ProvedorIntegracao::Infobip, AmbienteIntegracao::Producao)
            .await
    }

    async fn segredo_infobip(&self, campo: &str) -> Result<Option<String>, DomainError> {
        let Some(integ) = self.integracao_infobip().await? else {
            return Ok(None);
        };
        Ok(self.segredos_abertos(&integ).await?.get(campo).cloned())
    }

    async fn credenciais_infobip_abertas(&self) -> Result<Option<CredenciaisInfobip>, DomainError> {
        Ok(self.credenciais_infobip(false).await?)
    }

    async fn infobip_testar(&self) -> Result<Option<String>, DomainError> {
        let Some(c) = self.credenciais_infobip_abertas().await? else {
            return Ok(None);
        };
        let cli = cliente_infobip(&c);
        cli.testar().await?;
        Ok(Some(format!("conta responde — remetente {}", c.remetente)))
    }

    async fn infobip_enviar_teste(
        &self,
        telefone: &str,
        texto: &str,
    ) -> Result<Option<String>, DomainError> {
        use clarituz_domain::value_objects::{sms, telefone as tel};
        let Some(c) = self.credenciais_infobip_abertas().await? else {
            return Ok(None);
        };
        let to = tel::normalizar_whatsapp(telefone)
            .ok_or_else(|| DomainError::validacao("destino fora do formato E.164 (+55...)"))?;
        let est = sms::estimar(texto);
        let limite = c.limite_segmentos.max(1) as usize;
        if est.partes > limite {
            return Err(DomainError::validacao(format!(
                "texto excede {limite} segmentos ({} partes, {})",
                est.partes,
                est.codificacao.as_str()
            )));
        }
        let cli = cliente_infobip(&c);
        let envio = cli.enviar(&to, texto).await?;
        Ok(envio.message_id)
    }

    async fn sms_evento_ativo(&self, evento: &str) -> Result<bool, DomainError> {
        let Some(integ) = self.integracao_infobip().await? else {
            return Ok(false);
        };
        let Some(ev) = integ.config["eventos"].as_object() else {
            return Ok(false);
        };
        Ok(ev.get(evento).and_then(|v| v.as_bool()).unwrap_or(false))
    }
}

/// Converte as credenciais abertas do port (config + cofre) no tipo
/// interno do cliente HTTP — ponto único de montagem.
fn cliente_infobip(c: &CredenciaisInfobip) -> InfobipCliente {
    InfobipCliente::new(InfobipCredenciais {
        base_url: c.base_url.clone(),
        api_key: c.api_key.clone(),
        remetente: c.remetente.clone(),
        limite_segmentos: c.limite_segmentos,
        callback_url: c.callback_url.clone(),
    })
}
