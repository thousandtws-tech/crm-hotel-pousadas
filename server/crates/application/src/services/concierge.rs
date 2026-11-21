//! Maria Concierge — chat do hóspede sem login, com escopo restrito por
//! token opaco da reserva (portal) ou por telefone (WhatsApp inbound).
//!
//! O serviço de IA (`ConciergeIa`) só recebe o contexto seguro montado
//! aqui — dados da reserva correta + fatos cadastrados da pousada.
//! Sem IA configurada (ou falha) a resposta degrada para "a equipe já
//! foi avisada" e escala pra recepção — nunca silêncio, nunca inventa.

use std::sync::Arc;

use chrono::Utc;
use clarituz_domain::entities::NovoEnvio;
use clarituz_domain::error::DomainError;
use clarituz_domain::ports::*;

use crate::error::AppResult;

const HISTORICO_CTX: i64 = 10;
/// Resposta segura quando a IA está indisponível — escala sempre.
const FALLBACK: &str = "Recebi sua mensagem! Já avisei nossa equipe e alguém \
te responde em instantes por aqui mesmo. 😊";

pub struct ConciergeService {
    automacao: Arc<dyn AutomacaoRepository>,
    inna: Arc<dyn InnaRepository>,
    estabelecimentos: Arc<dyn EstabelecimentoRepository>,
    fila: Arc<dyn FilaEnvioRepository>,
    comunicacao: Arc<crate::services::ComunicacaoService>,
    ia: Option<Arc<dyn ConciergeIa>>,
    /// `hub.verify_token` do webhook Meta.
    verify_token: Option<String>,
    /// Segredo da app Meta p/ assinatura X-Hub-Signature-256.
    app_secret: Option<String>,
    lgpd: Arc<dyn LgpdRepository>,
    /// Pré-reserva determinística — intercepta intenção de reserva antes
    /// da Maria responder (IA nunca toca em datas/dinheiro).
    pre_reserva: Arc<crate::services::PreReservaService>,
    /// Roteamento — escalada vira protocolo por setor com SLA.
    atendimento: Arc<crate::services::AtendimentoService>,
}

impl ConciergeService {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        automacao: Arc<dyn AutomacaoRepository>,
        inna: Arc<dyn InnaRepository>,
        estabelecimentos: Arc<dyn EstabelecimentoRepository>,
        fila: Arc<dyn FilaEnvioRepository>,
        comunicacao: Arc<crate::services::ComunicacaoService>,
        ia: Option<Arc<dyn ConciergeIa>>,
        verify_token: Option<String>,
        app_secret: Option<String>,
        lgpd: Arc<dyn LgpdRepository>,
        pre_reserva: Arc<crate::services::PreReservaService>,
        atendimento: Arc<crate::services::AtendimentoService>,
    ) -> Self {
        Self {
            automacao,
            inna,
            estabelecimentos,
            fila,
            comunicacao,
            ia,
            verify_token,
            app_secret,
            lgpd,
            pre_reserva,
            atendimento,
        }
    }

    // ------------------------------------------------------------------
    // webhook Meta — verificação GET + segredo p/ HMAC do POST
    // ------------------------------------------------------------------

    pub fn whatsapp_challenge(&self, mode: &str, token: &str, challenge: &str) -> Option<String> {
        let esperado = self.verify_token.as_deref()?;
        if mode == "subscribe" && !esperado.is_empty() && token == esperado {
            Some(challenge.to_string())
        } else {
            None
        }
    }

    pub fn whatsapp_app_secret(&self) -> Option<&str> {
        self.app_secret.as_deref()
    }

    // ------------------------------------------------------------------
    // portal do hóspede — token opaco identifica a reserva
    // ------------------------------------------------------------------

    /// Contexto visível ao hóspede + histórico — abre a tela do chat.
    pub async fn abrir_portal(&self, token: uuid::Uuid) -> AppResult<serde_json::Value> {
        let r = self.reserva_token(token).await?;
        let historico = self.inna.historico(r.idreserva, 50).await?;
        Ok(serde_json::json!({
            "hospede": primeiro_nome(&r.cliente_nome),
            "acomodacao": r.acomodacao_nome,
            "entrada": r.entradaprevista,
            "saida": r.saidaprevista,
            "historico": historico,
        }))
    }

    pub async fn mensagem_portal(
        &self,
        token: uuid::Uuid,
        texto: &str,
    ) -> AppResult<serde_json::Value> {
        let r = self.reserva_token(token).await?;
        let resp = self.responder(&r, "portal", texto, None).await?;
        Ok(serde_json::json!({"resposta": resp.texto, "escalar": resp.escalar}))
    }

    // ------------------------------------------------------------------
    // WhatsApp inbound — telefone identifica a reserva ativa
    // ------------------------------------------------------------------

    /// Uma mensagem recebida do webhook Meta. `finais` = dígitos do `from`.
    pub async fn whatsapp_inbound(
        &self,
        de: &str,
        wamid: Option<&str>,
        texto: &str,
    ) -> AppResult<()> {
        let digitos: String = de.chars().filter(char::is_ascii_digit).collect();
        // LGPD — "sair"/"parar"/"stop" descadastra sem depender de reserva.
        if crate::services::lgpd::LgpdService::eh_opt_out(texto) {
            let n = self.lgpd.opt_out_telefone(&digitos, "whatsapp").await?;
            tracing::info!(atualizados = n, "whatsapp: opt-out registrado");
            self.fila
                .enfileirar(NovoEnvio {
                    canal: clarituz_domain::enums::CanalEnvio::Whatsapp,
                    destino: digitos,
                    template: "inna_concierge".into(),
                    payload: serde_json::json!({"tipo": "texto", "texto":
                        "Pronto — você não receberá mais mensagens promocionais. \
                         Comunicações sobre sua estadia seguem ativas."}),
                    idreserva: None,
                    idcliente: None,
                    idfuncionario: None,
                    agendado_para: Utc::now(),
                })
                .await?;
            return Ok(());
        }
        // Menu determinístico — primeiro contato recebe 1/2/3 antes de
        // qualquer IA (custo zero, nunca alucina). `wa_menu` é permanente:
        // quem já passou pelo menu cai direto no fluxo normal.
        let menu = self.automacao.wa_menu_obter(&digitos).await?;
        if let Some(m) = &menu {
            // Reentrega do provedor com o mesmo wamid — já processada.
            if wamid.is_some() && m.ultimo_wamid.as_deref() == wamid {
                return Ok(());
            }
        }
        match menu.as_ref().map(|m| m.estado.as_str()) {
            None => {
                self.automacao
                    .wa_menu_marcar(&digitos, "aguardando", wamid)
                    .await?;
                let est = self.estabelecimentos.obter().await?;
                let nome = est
                    .as_ref()
                    .and_then(|e| e.razao_social.clone())
                    .unwrap_or_else(|| "nossa pousada".into());
                self.enviar_texto(
                    &digitos,
                    &format!(
                        "Olá! 👋 Bem-vindo à {nome}.\n\nComo posso ajudar? \
                         Responda com o número:\n\n*1* — Reservas e tarifas\n\
                         *2* — Check-in\n*3* — Falar com atendente"
                    ),
                )
                .await?;
                return Ok(());
            }
            Some("aguardando") => {
                self.automacao
                    .wa_menu_marcar(&digitos, "concluido", wamid)
                    .await?;
                match texto.trim() {
                    "1" => {
                        let resp = self.pre_reserva.iniciar_fluxo(&digitos).await?;
                        self.enviar_texto(&digitos, &resp).await?;
                        return Ok(());
                    }
                    "2" => {
                        let resp = self.menu_checkin(&digitos).await?;
                        self.enviar_texto(&digitos, &resp).await?;
                        return Ok(());
                    }
                    "3" => {
                        let ab = self
                            .atendimento
                            .abrir_telefone("whatsapp", &digitos, texto, Some("menu_atendente"))
                            .await?;
                        self.enviar_texto(
                            &digitos,
                            &format!(
                                "Já chamei um atendente — protocolo *{}*. \
                                 Responderemos por aqui mesmo. 😊",
                                ab.protocolo
                            ),
                        )
                        .await?;
                        return Ok(());
                    }
                    // Qualquer outro texto encerra o menu e segue pro
                    // fluxo normal (pré-reserva → reserva → Maria).
                    _ => {}
                }
            }
            _ => {}
        }
        // Pré-reserva — fluxo determinístico por telefone; funciona sem
        // reserva ativa (é justamente pra criar uma). Se a mensagem não é
        // do fluxo, segue pro caminho normal (reserva → Maria).
        if let Some(resp) = self.pre_reserva.processar(&digitos, texto).await? {
            self.fila
                .enfileirar(NovoEnvio {
                    canal: clarituz_domain::enums::CanalEnvio::Whatsapp,
                    destino: digitos,
                    template: "pre_reserva".into(),
                    payload: serde_json::json!({"tipo": "texto", "texto": resp}),
                    idreserva: None,
                    idcliente: None,
                    idfuncionario: None,
                    agendado_para: Utc::now(),
                })
                .await?;
            return Ok(());
        }
        let Some(r) = self.automacao.reserva_por_telefone(&digitos).await? else {
            // Telefone sem reserva ativa — dedup antes de qualquer saída.
            tracing::info!(finais = %right8(&digitos), "whatsapp inbound: sem reserva");
            return Ok(());
        };
        // Dedup por wamid — a Meta reentrega até receber 200.
        if self
            .inna
            .gravar_mensagem(r.idreserva, "whatsapp", "hospede", texto, wamid)
            .await?
            .is_none()
        {
            return Ok(());
        }
        let resp = self.responder(&r, "whatsapp", texto, None).await?;
        // Janela de 24h da Meta está aberta — resposta é texto livre.
        self.fila
            .enfileirar(NovoEnvio {
                canal: clarituz_domain::enums::CanalEnvio::Whatsapp,
                destino: digitos,
                template: "inna_concierge".into(),
                payload: serde_json::json!({"tipo": "texto", "texto": resp.texto}),
                idreserva: Some(r.idreserva),
                idcliente: Some(r.idcliente),
                idfuncionario: None,
                agendado_para: Utc::now(),
            })
            .await?;
        Ok(())
    }

    // ------------------------------------------------------------------
    // núcleo — registra, chama a IA com contexto restrito, escala
    // ------------------------------------------------------------------

    /// Texto da opção "2-Check-in": hóspede com reserva recebe o link da
    /// pré-ficha; sem reserva recebe os horários + pede o nome.
    async fn menu_checkin(&self, digitos: &str) -> AppResult<String> {
        let est = self.estabelecimentos.obter().await?;
        let checkin = est
            .as_ref()
            .and_then(|e| e.horario_checkin.clone())
            .unwrap_or_else(|| "14h".into());
        let checkout = est
            .as_ref()
            .and_then(|e| e.horario_checkout.clone())
            .unwrap_or_else(|| "10h".into());
        if let Some(r) = self.automacao.reserva_por_telefone(digitos).await? {
            let mut txt = format!(
                "Seu check-in é a partir das {checkin}. \
                 Para agilizar, complete sua ficha de hospedagem:"
            );
            if let Some(link) = self.comunicacao.link_fnrh(&r) {
                txt.push_str(&format!(" {link}"));
            } else {
                txt.push_str(" a recepção te envia o link em instantes.");
            }
            return Ok(txt);
        }
        Ok(format!(
            "Check-in a partir das {checkin}; check-out até {checkout}. \
             Já tem reserva? Me passa o nome completo que eu localizo pra você."
        ))
    }

    /// Enfileira resposta WhatsApp livre — janela de 24h do provedor
    /// está aberta pelo inbound que acabou de chegar.
    async fn enviar_texto(&self, destino: &str, texto: &str) -> AppResult<()> {
        self.fila
            .enfileirar(NovoEnvio {
                canal: clarituz_domain::enums::CanalEnvio::Whatsapp,
                destino: destino.to_string(),
                template: "wa_menu".into(),
                payload: serde_json::json!({"tipo": "texto", "texto": texto}),
                idreserva: None,
                idcliente: None,
                idfuncionario: None,
                agendado_para: Utc::now(),
            })
            .await?;
        Ok(())
    }

    async fn reserva_token(&self, token: uuid::Uuid) -> AppResult<ReservaAuto> {
        self.automacao
            .reserva_publica_por_token(token)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("reserva não encontrada"))
            .map_err(Into::into)
    }

    /// Contexto seguro: fatos cadastrados da pousada + dados da PRÓPRIA
    /// reserva do hóspede. Nada de preços de terceiros, agenda ou estoque.
    async fn contexto(&self, r: &ReservaAuto) -> AppResult<serde_json::Value> {
        let est = self.estabelecimentos.obter().await?;
        Ok(serde_json::json!({
            "pousada": {
                "wifi_nome": est.as_ref().and_then(|e| e.wifi_nome.clone()),
                "wifi_senha": est.as_ref().and_then(|e| e.wifi_senha.clone()),
                "horario_checkin": est.as_ref().and_then(|e| e.horario_checkin.clone()),
                "horario_checkout": est.as_ref().and_then(|e| e.horario_checkout.clone()),
                "horario_cafe": est.as_ref().and_then(|e| e.horario_cafe.clone()),
                "info_servicos": est.as_ref().and_then(|e| e.info_servicos.clone()),
                "telefone_recepcao": est
                    .as_ref()
                    .and_then(|e| e.telefone.clone().or_else(|| e.celular.clone())),
            },
            "reserva": {
                "hospede": primeiro_nome(&r.cliente_nome),
                "acomodacao": r.acomodacao_nome,
                "entrada": r.entradaprevista,
                "saida": r.saidaprevista,
            },
        }))
    }

    async fn responder(
        &self,
        r: &ReservaAuto,
        canal: &str,
        texto: &str,
        provider_id: Option<&str>,
    ) -> AppResult<ConciergeResposta> {
        // Portal não passa provider_id — grava direto; WhatsApp já gravou
        // no inbound p/ dedup (chega aqui com provider_id None).
        if canal == "portal" {
            self.inna
                .gravar_mensagem(r.idreserva, canal, "hospede", texto, provider_id)
                .await?;
        }
        let contexto = self.contexto(r).await?;
        let historico = self.inna.historico(r.idreserva, HISTORICO_CTX).await?;
        let mut resp = match &self.ia {
            Some(ia) => ia
                .responder(&contexto, texto, &historico)
                .await
                .unwrap_or_else(|e| {
                    tracing::warn!(erro = %e, "concierge: IA falhou — fallback");
                    ConciergeResposta {
                        texto: FALLBACK.into(),
                        escalar: true,
                        motivo: Some("ia_indisponivel".into()),
                    }
                }),
            None => ConciergeResposta {
                texto: FALLBACK.into(),
                escalar: true,
                motivo: Some("ia_nao_configurada".into()),
            },
        };
        self.inna
            .gravar_mensagem(r.idreserva, canal, "inna", &resp.texto, None)
            .await?;
        if resp.escalar {
            // Protocolo roteado — urgência acorda recepção+gerência na
            // hora; normal entra na fila do setor com SLA de aceite.
            match self
                .atendimento
                .abrir(canal, r, texto, resp.motivo.as_deref())
                .await
            {
                Ok(ab) => {
                    resp.texto = format!(
                        "{}\n\nProtocolo *{}* — {}",
                        resp.texto,
                        ab.protocolo,
                        if ab.urgente {
                            "a equipe foi acionada agora.".to_string()
                        } else if ab.fora_horario {
                            format!(
                                "estamos fora do horário; respondemos a partir das {}.",
                                ab.abre_as
                            )
                        } else {
                            format!("já encaminhei pro setor de {}.", ab.setor)
                        },
                    );
                }
                Err(e) => {
                    tracing::warn!(erro = %e, "concierge: abertura de protocolo falhou");
                    self.comunicacao
                        .avisar_equipe(
                            "inna.escalada",
                            "Maria pediu atendimento humano",
                            &format!(
                                "{} (reserva #{}, {}): {}",
                                primeiro_nome(&r.cliente_nome),
                                r.idreserva,
                                canal,
                                texto.chars().take(120).collect::<String>(),
                            ),
                            Some(r.idreserva),
                        )
                        .await?;
                }
            }
        }
        Ok(resp)
    }
}

fn primeiro_nome(nome: &str) -> &str {
    nome.split_whitespace().next().unwrap_or(nome)
}

fn right8(s: &str) -> &str {
    &s[s.len().saturating_sub(8)..]
}
