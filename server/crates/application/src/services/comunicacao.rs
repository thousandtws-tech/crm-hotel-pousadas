//! Comunicação com hóspedes e equipe — dispatcher da matriz, worker da
//! fila persistente, automações (FNRH/check-out/pesquisa/cobrança) e
//! reputação (avaliações, NPS). Senders são `Emissor` plugáveis — sem
//! credenciais configuradas o item falha e volta pra fila com backoff,
//! sem derrubar nada.

use std::fmt::Write;
use std::sync::Arc;

use crate::actor::Ator;
use chrono::{Duration, Utc};
use clarituz_domain::entities::*;
use clarituz_domain::enums::{CanalEnvio, StatusAvaliacao, StatusEnvio, StatusReserva};
use clarituz_domain::error::DomainError;
use clarituz_domain::events::{Aviso, TipoAviso};
use clarituz_domain::ports::*;
use clarituz_domain::value_objects::telefone;

use crate::dto::RespostaAvaliacaoInput;
use crate::error::AppResult;

const MAX_LOTE: i64 = 50;
const LEMBRETE_DIAS: i64 = 3;
const EXPIRAR_AVALIACAO_DIAS: i64 = 14;

// -- pós-reserva: comunicação transacional ------------------------------------

/// Mensagem de reserva registrada aguardando pagamento/análise.
pub const TPL_RESERVA_AGUARDANDO: &str = "reserva_aguardando";
/// Confirmação efetiva da reserva (uma única vez por transição real).
pub const TPL_RESERVA_CONFIRMADA: &str = "reserva_confirmada";
/// Aviso de cancelamento (manual ou hold expirado).
pub const TPL_RESERVA_CANCELADA: &str = "reserva_cancelada";
/// Versão dos templates pós-reserva — bump ao mudar texto/campos.
const VERSAO_POS_RESERVA: i32 = 1;
/// Prefixo dos templates transacionais de reserva — marca quais itens
/// passam por verificação de estado pré-envio e tratamento de ambiguidade.
const TPL_POS_RESERVA_PREFIX: &str = "reserva_";
/// Janela mínima entre reenvios manuais da mesma reserva.
const REENVIO_JANELA_SEG: i64 = 120;

/// Resultado do processamento de um item da fila — distingue envio
/// aceito de supressão por verificação pré-envio.
enum OutcomeEnvio {
    /// Provedor aceitou — `provider_msg_id` quando devolvido.
    Enviado(Option<String>),
    /// Intenção obsoleta ou destino inválido — item vira 'suprimido'.
    Suprimido(String),
}

pub struct ComunicacaoService {
    fila: Arc<dyn FilaEnvioRepository>,
    push: Arc<dyn PushRepository>,
    avaliacoes: Arc<dyn AvaliacaoRepository>,
    automacao: Arc<dyn AutomacaoRepository>,
    emissores: Vec<Arc<dyn Emissor>>,
    eventos: Arc<dyn EventoPublisher>,
    /// Base pública dos links de hóspede — ex.: https://espiritodomar.com.br
    site_base: String,
    /// URL pública da API + segredo do link de descadastro (art. 8º LGPD).
    api_base: Option<String>,
    link_secret: String,
    pousada: String,
    lgpd: Arc<dyn LgpdRepository>,
    /// Seleção explícita do provedor WhatsApp — `None` em testes legados.
    com_resolver: Option<Arc<dyn ComunicacaoResolver>>,
}

impl ComunicacaoService {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        fila: Arc<dyn FilaEnvioRepository>,
        push: Arc<dyn PushRepository>,
        avaliacoes: Arc<dyn AvaliacaoRepository>,
        automacao: Arc<dyn AutomacaoRepository>,
        emissores: Vec<Arc<dyn Emissor>>,
        eventos: Arc<dyn EventoPublisher>,
        site_base: &str,
        api_base: Option<String>,
        link_secret: String,
        pousada: String,
        lgpd: Arc<dyn LgpdRepository>,
        com_resolver: Option<Arc<dyn ComunicacaoResolver>>,
    ) -> Self {
        Self {
            fila,
            push,
            avaliacoes,
            automacao,
            emissores,
            eventos,
            site_base: site_base.trim_end_matches('/').into(),
            api_base: api_base.map(|u| u.trim_end_matches('/').to_string()),
            link_secret,
            pousada,
            lgpd,
            com_resolver,
        }
    }

    // ------------------------------------------------------------------
    // dispatcher: evento interno → canais externos conforme a matriz
    // ------------------------------------------------------------------

    /// Avisa a equipe por todos os canais que a matriz marca para o evento.
    /// `inbox` publica um Aviso no EventBus (vira notificacao interna + SSE).
    pub async fn avisar_equipe(
        &self,
        evento: &str,
        assunto: &str,
        mensagem: &str,
        idreserva: Option<i64>,
    ) -> AppResult<()> {
        for regra in self.fila.regras_do_evento(evento).await? {
            match regra.canal {
                CanalEnvio::Whatsapp => {}
                CanalEnvio::Inbox => {
                    let mut aviso = Aviso::novo(TipoAviso::Info, assunto, mensagem)
                        .dados(serde_json::json!({"idreserva": idreserva}));
                    aviso.ate_nivel = regra.papel;
                    self.eventos.avisar(aviso);
                }
                CanalEnvio::Email => {
                    self.fila
                        .enfileirar(NovoEnvio {
                            canal: CanalEnvio::Email,
                            destino: format!("papel:{}", regra.papel),
                            template: "alerta_equipe".into(),
                            payload: serde_json::json!({
                                "assunto": assunto,
                                "html": Self::html_equipe(assunto, mensagem, &self.pousada),
                            }),
                            idreserva,
                            idcliente: None,
                            idfuncionario: None,
                            agendado_para: Utc::now(),
                        })
                        .await?;
                }
                CanalEnvio::Push => {
                    for sub in self.push.por_papel(regra.papel).await? {
                        self.fila
                            .enfileirar(NovoEnvio {
                                canal: CanalEnvio::Push,
                                destino: sub.endpoint.clone(),
                                template: "alerta_equipe".into(),
                                payload: serde_json::json!({"titulo": assunto}),
                                idreserva,
                                idcliente: None,
                                idfuncionario: Some(sub.idfuncionario),
                                agendado_para: Utc::now(),
                            })
                            .await?;
                    }
                }
            }
        }
        Ok(())
    }

    // ------------------------------------------------------------------
    // worker — drena a fila (chamado pelo tokio task no boot)
    // ------------------------------------------------------------------

    pub async fn drenar_fila(&self) -> AppResult<u32> {
        let itens = self.fila.proximos(Utc::now(), MAX_LOTE).await?;
        let mut processados = 0;
        for item in itens {
            processados += 1;
            match self.enviar_item(&item).await {
                Ok(OutcomeEnvio::Enviado(provider_id)) => {
                    self.fila.marcar_enviado(item.id, provider_id).await?;
                }
                Ok(OutcomeEnvio::Suprimido(motivo)) => {
                    self.fila.marcar_suprimido(item.id, &motivo).await?;
                    tracing::info!(id = item.id, motivo = %motivo, "fila_envio: suprimido");
                }
                Err(e) => {
                    // Sem resposta do provedor em template transacional de
                    // reserva: o envio pode ter chegado — resultado ambíguo
                    // vira 'desconhecido' (nunca retry cego; reconciliação
                    // ou reenvio manual auditado).
                    if e == DomainError::Infra
                        && item.canal == CanalEnvio::Whatsapp
                        && item.template.starts_with(TPL_POS_RESERVA_PREFIX)
                    {
                        self.fila
                            .marcar_desconhecido(item.id, &e.to_string())
                            .await?;
                        tracing::warn!(id = item.id, "fila_envio: resultado ambíguo");
                    } else {
                        let backoff = 60i64 * (1 << item.tentativas.min(5));
                        self.fila
                            .marcar_falha(item.id, &e.to_string(), backoff)
                            .await?;
                        tracing::warn!(id = item.id, erro = %e, "fila_envio: falha");
                    }
                }
            }
        }
        Ok(processados)
    }

    async fn enviar_item(&self, item: &ItemFila) -> Result<OutcomeEnvio, DomainError> {
        if item.canal == CanalEnvio::Email && self.fila.email_suprimido(&item.destino).await? {
            return Ok(OutcomeEnvio::Suprimido(
                "destino suprimido (bounce/complaint)".into(),
            ));
        }
        // Templates pós-reserva: o estado pode ter transitado entre o
        // enfileiramento e o envio — pendência vira 'suprimido' quando a
        // confirmação (ou cancelamento) já ocorreu; opt-in e telefone do
        // hóspede são re-checados na hora do disparo.
        if item.template.starts_with(TPL_POS_RESERVA_PREFIX) {
            if let Some(motivo) = self.motivo_supressao(item).await? {
                return Ok(OutcomeEnvio::Suprimido(motivo));
            }
        }
        // LGPD: opt-out suprime templates não-transacionais (pesquisa,
        // campanhas) — o operacional da estadia continua.
        let mut payload = item.payload.clone();
        if let Some(idc) = item.idcliente {
            if crate::services::lgpd::TEMPLATES_SUPRIMIVEIS.contains(&item.template.as_str()) {
                if self.lgpd.cliente_opt_out(idc).await? {
                    return Ok(OutcomeEnvio::Suprimido("opt-out LGPD".into()));
                }
                // Todo e-mail suprimível carrega o link de descadastro
                // assinado (art. 8º — revogação tão fácil quanto o consent).
                if let Some(f) = self.footer_descadastro(idc) {
                    if let Some(html) = payload.get_mut("html").and_then(|h| h.as_str()) {
                        payload["html"] = serde_json::Value::String(format!("{html}{f}"));
                    }
                }
            }
        }
        // WhatsApp: seleção explícita — provedor gravado no item tem
        // precedência; quando vazio, o resolver decide e o resultado é
        // persistido pra que retries nunca troquem de conta.
        if item.canal == CanalEnvio::Whatsapp {
            if let Some(resolver) = &self.com_resolver {
                let r = resolver.whatsapp(item.provedor.as_deref()).await?;
                if item.provedor.is_none() {
                    self.fila
                        .vincular_provedor(item.id, &r.provedor, r.idintegracao)
                        .await?;
                }
                return r
                    .emissor
                    .enviar(&item.destino, &item.template, &payload)
                    .await
                    .map(OutcomeEnvio::Enviado);
            }
        }
        let emissor = self
            .emissores
            .iter()
            .find(|e| e.canal() == item.canal)
            .ok_or_else(|| DomainError::regra("canal sem emissor configurado"))?;
        emissor
            .enviar(&item.destino, &item.template, &payload)
            .await
            .map(OutcomeEnvio::Enviado)
    }

    /// Verificação pré-envio dos templates pós-reserva — devolve o motivo
    /// quando a intenção virou obsoleta/inválida (`Some` = suprimir).
    async fn motivo_supressao(&self, item: &ItemFila) -> Result<Option<String>, DomainError> {
        let Some(idr) = item.idreserva else {
            return Ok(Some("sem reserva associada".into()));
        };
        let Some(snap) = self.automacao.reserva_pos_reserva(idr).await? else {
            return Ok(Some("reserva não encontrada".into()));
        };
        if item.canal == CanalEnvio::Whatsapp {
            if !snap.whatsapp_optin {
                return Ok(Some("hóspede não autorizou WhatsApp transacional".into()));
            }
            if telefone::normalizar_whatsapp(&item.destino).is_none() {
                return Ok(Some("telefone do hóspede inválido".into()));
            }
        }
        let obsoleto = match item.template.as_str() {
            // Aguardando pagamento/análise só vale enquanto a reserva segue
            // pendente e sem pagamento liquidado.
            TPL_RESERVA_AGUARDANDO => {
                snap.status != StatusReserva::Pendente || snap.pago_centavos > 0
            }
            TPL_RESERVA_CONFIRMADA => snap.status == StatusReserva::Cancelada,
            TPL_RESERVA_CANCELADA => snap.status != StatusReserva::Cancelada,
            _ => false,
        };
        Ok(obsoleto.then(|| {
            let lbl = match snap.status {
                StatusReserva::Pendente => "pendente",
                StatusReserva::Iniciada => "em estadia",
                StatusReserva::Cancelada => "cancelada",
                StatusReserva::Finalizada => "finalizada",
            };
            format!(
                "estado mudou após enfileirar (status {lbl}, pago ¢{})",
                snap.pago_centavos
            )
        }))
    }

    /// Marcos de entrega/leitura — chamados pelo webhook Z-API.
    pub async fn marcar_entrega(&self, provedor: &str, provider_msg_id: &str) -> AppResult<u64> {
        Ok(self.fila.marcar_entrega(provedor, provider_msg_id).await?)
    }
    pub async fn marcar_lido(&self, provedor: &str, provider_msg_id: &str) -> AppResult<u64> {
        Ok(self.fila.marcar_lido(provedor, provider_msg_id).await?)
    }

    /// Rodapé LGPD com link de descadastro assinado (HMAC `lgpd:{id}`).
    fn footer_descadastro(&self, idcliente: i64) -> Option<String> {
        use hmac::{Hmac, Mac};
        use sha2::Sha256;
        let base = self.api_base.as_deref()?;
        let mut mac = Hmac::<Sha256>::new_from_slice(self.link_secret.as_bytes()).ok()?;
        mac.update(format!("lgpd:{idcliente}").as_bytes());
        let sig = hex::encode(mac.finalize().into_bytes());
        Some(format!(
            "<hr style='margin-top:24px;border:none;border-top:1px solid #eee'>\
             <p style='font-size:11px;color:#999'>Não quer mais receber estas \
             mensagens? <a href='{base}/api/v1/publico/lgpd/descadastrar?c={idcliente}&s={sig}'>\
             Descadastrar</a></p>"
        ))
    }

    // ------------------------------------------------------------------
    // automações — rodadas diárias (cron no boot, mesma técnica do sweeper)
    // ------------------------------------------------------------------

    /// Rodada do agendador: lembretes FNRH (-24h), check-out (dia),
    /// pesquisa pós-estadia, reenvio +3d e expiração de pendências.
    pub async fn rodar_lembretes(&self) -> AppResult<()> {
        let amanha = (Utc::now() + Duration::days(1)).date_naive();
        let hoje = Utc::now().date_naive();

        // FNRH — check-in amanhã, pré-ficha pendente, ainda não lembrado.
        for r in self.automacao.checkins_sem_fnrh(amanha).await? {
            if self
                .automacao
                .existe_envio(r.idreserva, "lembrete_fnrh", CanalEnvio::Email)
                .await?
            {
                continue;
            }
            self.enviar_fnrh(&r, "lembrete_fnrh").await;
        }

        // Check-out — no dia, ainda iniciada.
        for r in self.automacao.checkouts_do_dia(hoje).await? {
            if self
                .automacao
                .existe_envio(r.idreserva, "lembrete_checkout", CanalEnvio::Email)
                .await?
            {
                continue;
            }
            self.enviar_checkout(&r).await;
        }

        // Pesquisa — finalizadas recentemente sem avaliação.
        let desde = Utc::now() - Duration::days(1);
        for r in self.automacao.finalizadas_sem_avaliacao(desde).await? {
            match self
                .avaliacoes
                .criar(r.idreserva, r.idcliente, "direto")
                .await
            {
                Ok(av) => {
                    self.enviar_pesquisa(&r, &av, false).await;
                }
                Err(e) => {
                    tracing::warn!(idreserva = r.idreserva, erro = %e, "avaliação: criar falhou");
                }
            }
        }

        // Lembrete +3d para pendentes.
        let limite = Utc::now() - Duration::days(LEMBRETE_DIAS);
        for av in self.avaliacoes.pendentes_lembrete(limite).await? {
            if let Ok(Some(r)) = self.reserva_auto(av.idreserva).await {
                self.enviar_pesquisa(&r, &av, true).await;
            }
            self.avaliacoes.marcar_lembrete(av.id).await?;
        }

        // Expira pendências antigas — NPS não conta o que nunca respondeu.
        let expira = Utc::now() - Duration::days(EXPIRAR_AVALIACAO_DIAS);
        for av in self.avaliacoes.pendentes_expirar(expira).await? {
            self.avaliacoes.expirar(av.id).await?;
        }

        Ok(())
    }

    async fn reserva_auto(&self, idreserva: i64) -> Result<Option<ReservaAuto>, DomainError> {
        // Reuso: o repositório de automação resolve por token; aqui a
        // avaliação já traz idreserva — busca via consulta direta do repo.
        self.automacao.reserva_por_id(idreserva).await
    }

    // ------------------------------------------------------------------
    // envio direto ao hóspede (também usável por rotas manuais)
    // ------------------------------------------------------------------

    /// Link da pré-ficha — chamado na confirmação da reserva e no cron.
    pub async fn enviar_fnrh(&self, r: &ReservaAuto, template: &str) {
        let Some(token) = r.token_publico else { return };
        let link = format!("{}/fnrh/{}", self.site_base, token);
        let corpo = serde_json::json!({
            "assunto": format!("Complete sua ficha de hospedagem — {}", self.pousada),
            "html": self.html_fnrh(r, &link),
            "tipo": "texto",
            "texto": format!(
                "Olá, {}! Complete sua ficha de hospedagem antes do check-in ({}): {}",
                primeiro_nome(&r.cliente_nome),
                r.entradaprevista.format("%d/%m"),
                link
            ),
        });
        self.enfileirar_hospede(r, template, corpo).await;
    }

    async fn enviar_checkout(&self, r: &ReservaAuto) {
        let Some(token) = r.token_publico else { return };
        let link = format!("{}/checkout-online/{}", self.site_base, token);
        let corpo = serde_json::json!({
            "assunto": format!("Lembrete de check-out — {}", self.pousada),
            "html": self.html_checkout(r, &link),
            "tipo": "texto",
            "texto": format!(
                "Olá, {}! Seu check-out é hoje — libere o quarto até o horário combinado: {}",
                primeiro_nome(&r.cliente_nome),
                link
            ),
        });
        self.enfileirar_hospede(r, "lembrete_checkout", corpo).await;
    }

    /// Cobrança — recepção dispara manualmente com o link de pagamento.
    pub async fn enviar_cobranca(&self, r: &ReservaAuto, link_pagamento: &str) {
        let corpo = serde_json::json!({
            "assunto": format!("Pagamento da sua reserva — {}", self.pousada),
            "html": self.html_cobranca(r, link_pagamento),
            "tipo": "texto",
            "texto": format!(
                "Olá, {}! Para confirmar sua reserva, pague por aqui: {}",
                primeiro_nome(&r.cliente_nome),
                link_pagamento
            ),
        });
        self.enfileirar_hospede(r, "cobranca", corpo).await;
    }

    /// Pesquisa pós-estadia — link único por avaliação (token próprio).
    pub async fn enviar_pesquisa(&self, r: &ReservaAuto, av: &Avaliacao, lembrete: bool) {
        let link = format!("{}/avaliacao/{}", self.site_base, av.token);
        let assunto = if lembrete {
            format!("Como foi sua estadia? — {}", self.pousada)
        } else {
            format!(
                "Obrigado pela estadia, {}! — {}",
                primeiro_nome(&r.cliente_nome),
                self.pousada
            )
        };
        let corpo = serde_json::json!({
            "assunto": assunto,
            "html": self.html_pesquisa(r, &link, lembrete),
            "tipo": "texto",
            "texto": format!(
                "Olá, {}! Conte em 1 minuto como foi sua estadia: {}",
                primeiro_nome(&r.cliente_nome),
                link
            ),
        });
        // Pesquisa usa template próprio do lembrete pra dedup separado.
        let template = if lembrete {
            "pesquisa_lembrete"
        } else {
            "pesquisa"
        };
        self.enfileirar_hospede(r, template, corpo).await;
        let _ = self.avaliacoes.marcar_enviada(av.id).await;
    }

    /// Enfileira para e-mail + WhatsApp do hóspede (supressão checada no envio).
    async fn enfileirar_hospede(&self, r: &ReservaAuto, template: &str, corpo: serde_json::Value) {
        let agora = Utc::now();
        if let Some(email) = &r.cliente_email {
            let _ = self
                .fila
                .enfileirar(NovoEnvio {
                    canal: CanalEnvio::Email,
                    destino: email.clone(),
                    template: template.into(),
                    payload: corpo.clone(),
                    idreserva: Some(r.idreserva),
                    idcliente: Some(r.idcliente),
                    idfuncionario: None,
                    agendado_para: agora,
                })
                .await;
        }
        // WhatsApp só com consentimento transacional gravado — e-mail
        // continua sendo o canal default quando o hóspede não optou.
        if r.whatsapp_optin {
            if let Some(fone) = &r.cliente_telefone {
                let _ = self
                    .fila
                    .enfileirar(NovoEnvio {
                        canal: CanalEnvio::Whatsapp,
                        destino: fone.clone(),
                        template: template.into(),
                        payload: corpo.clone(),
                        idreserva: Some(r.idreserva),
                        idcliente: Some(r.idcliente),
                        idfuncionario: None,
                        agendado_para: agora,
                    })
                    .await;
            }
        }
    }

    // ------------------------------------------------------------------
    // comunicação transacional pós-reserva
    // ------------------------------------------------------------------

    /// Reserva persistida pelo site — chamado pós-commit pelo serviço de
    /// reservas. Enfileira o aviso de pendência (pagamento/análise) de
    /// acordo com o estado atual; rollback da reserva nunca chega aqui.
    pub async fn sinalizar_reserva_criada(&self, idreserva: i64) -> AppResult<()> {
        let Some(snap) = self.automacao.reserva_pos_reserva(idreserva).await? else {
            return Ok(());
        };
        match snap.status {
            StatusReserva::Pendente => {
                self.enfileirar_pos_reserva(&snap, TPL_RESERVA_AGUARDANDO)
                    .await
            }
            // Criada já efetiva (ex.: pagamento no local confirmado na
            // recepção) — vai direto a confirmação.
            StatusReserva::Iniciada | StatusReserva::Finalizada => {
                self.enfileirar_pos_reserva(&snap, TPL_RESERVA_CONFIRMADA)
                    .await
            }
            StatusReserva::Cancelada => Ok(()),
        }
    }

    /// Transição real para confirmada — chamada só quando a evidência é
    /// backend-validada (pagamento liquidado, confirmação manual). A
    /// `dedup_key` garante exatamente uma confirmação por reserva/canal;
    /// chamadas repetidas (webhook duplicado, conciliação) são no-ops.
    pub async fn sinalizar_reserva_confirmada(&self, idreserva: i64) -> AppResult<()> {
        let Some(snap) = self.automacao.reserva_pos_reserva(idreserva).await? else {
            return Ok(());
        };
        if snap.status == StatusReserva::Cancelada {
            return Ok(());
        }
        // Pendência ainda na fila ficou obsoleta — suprime antes de
        // enfileirar a confirmação (ordem: suprimir → enfileirar).
        let _ = self
            .fila
            .suprimir_pendentes(idreserva, &[TPL_RESERVA_AGUARDANDO], "reserva confirmada")
            .await?;
        self.enfileirar_pos_reserva(&snap, TPL_RESERVA_CONFIRMADA)
            .await
    }

    /// Cancelamento manual ou hold expirado — suprime pendências e
    /// enfileira o aviso uma única vez.
    pub async fn sinalizar_reserva_cancelada(&self, idreserva: i64) -> AppResult<()> {
        let Some(snap) = self.automacao.reserva_pos_reserva(idreserva).await? else {
            return Ok(());
        };
        if snap.status != StatusReserva::Cancelada {
            return Ok(());
        }
        let _ = self
            .fila
            .suprimir_pendentes(
                idreserva,
                &[TPL_RESERVA_AGUARDANDO, TPL_RESERVA_CONFIRMADA],
                "reserva cancelada",
            )
            .await?;
        self.enfileirar_pos_reserva(&snap, TPL_RESERVA_CANCELADA)
            .await
    }

    /// Enfileira o template pós-reserva para os canais do hóspede —
    /// e-mail sempre que houver endereço; WhatsApp somente com o
    /// consentimento transacional gravado (re-checado no envio).
    async fn enfileirar_pos_reserva(&self, r: &ReservaPosReserva, template: &str) -> AppResult<()> {
        let corpo = self.corpo_pos_reserva(r, template);
        let agora = Utc::now();
        if let Some(email) = &r.cliente_email {
            self.fila
                .enfileirar_dedup(
                    &NovoEnvio {
                        canal: CanalEnvio::Email,
                        destino: email.clone(),
                        template: template.into(),
                        payload: corpo.clone(),
                        idreserva: Some(r.idreserva),
                        idcliente: Some(r.idcliente),
                        idfuncionario: None,
                        agendado_para: agora,
                    },
                    &dedup_pos_reserva(r.idreserva, template, CanalEnvio::Email),
                    VERSAO_POS_RESERVA,
                )
                .await?;
        }
        if r.whatsapp_optin {
            if let Some(fone) = &r.cliente_telefone {
                // Normaliza já na intenção (DDI) — inválido entra como veio
                // e a verificação pré-envio suprime com motivo auditável.
                let destino = telefone::normalizar_whatsapp(fone).unwrap_or_else(|| fone.clone());
                self.fila
                    .enfileirar_dedup(
                        &NovoEnvio {
                            canal: CanalEnvio::Whatsapp,
                            destino,
                            template: template.into(),
                            payload: corpo,
                            idreserva: Some(r.idreserva),
                            idcliente: Some(r.idcliente),
                            idfuncionario: None,
                            agendado_para: agora,
                        },
                        &dedup_pos_reserva(r.idreserva, template, CanalEnvio::Whatsapp),
                        VERSAO_POS_RESERVA,
                    )
                    .await?;
            }
        }
        Ok(())
    }

    /// Histórico de comunicações da reserva — seção "Comunicações" do
    /// detalhe (qualquer ator autenticado; o item já é registro do CRM).
    pub async fn comunicacoes_reserva(
        &self,
        _ator: &Ator,
        idreserva: i64,
    ) -> AppResult<Vec<ItemFila>> {
        Ok(self.fila.por_reserva(idreserva).await?)
    }

    /// Reenvio manual — admin, limitado e auditado. O item original é
    /// preservado; o reenvio cria um NOVO item (`dedup :re{id}`) com
    /// ciclo de vida próprio — nunca sobrescreve a tentativa anterior.
    /// Item 'desconhecido' exige justamente esta decisão do operador
    /// após reconciliar com o provedor.
    pub async fn reenviar_comunicacao(
        &self,
        ator: &Ator,
        idreserva: i64,
        item_id: i64,
    ) -> AppResult<ItemFila> {
        ator.exigir_admin()?;
        let Some(item) = self.fila.buscar(item_id).await? else {
            return Err(DomainError::nao_encontrado("Comunicação não encontrada.").into());
        };
        if item.idreserva != Some(idreserva) {
            return Err(DomainError::validacao("Item não pertence à reserva.").into());
        }
        if matches!(item.status, StatusEnvio::Pendente | StatusEnvio::Enviando) {
            return Err(DomainError::regra("Comunicação ainda em processamento.").into());
        }
        if self
            .fila
            .reenvios_recentes(idreserva, REENVIO_JANELA_SEG)
            .await?
            >= 1
        {
            return Err(DomainError::regra(
                "Reenvio manual recente — aguarde antes de tentar novamente.",
            )
            .into());
        }
        let base = item.dedup_key.clone().unwrap_or_else(|| {
            format!(
                "pos:{}:{}:{}:v{}",
                idreserva,
                item.template,
                canal_rotulo(item.canal),
                item.template_versao
            )
        });
        let Some(novo_id) = self
            .fila
            .enfileirar_dedup(
                &NovoEnvio {
                    canal: item.canal,
                    destino: item.destino.clone(),
                    template: item.template.clone(),
                    payload: item.payload.clone(),
                    idreserva: Some(idreserva),
                    idcliente: item.idcliente,
                    idfuncionario: Some(ator.id),
                    agendado_para: Utc::now(),
                },
                &format!("{base}:re{item_id}"),
                item.template_versao,
            )
            .await?
        else {
            return Err(DomainError::conflito("Esta comunicação já foi reenviada.").into());
        };
        self.eventos.avisar(
            Aviso::novo(
                TipoAviso::Info,
                "Reenvio manual de comunicação",
                format!(
                    "{} reenviou a comunicação #{item_id} como nova intenção #{novo_id} (reserva Nº{idreserva}).",
                    ator.nome
                ),
            )
            .de_ator(ator.id, &ator.nome)
            .dados(serde_json::json!({
                "idreserva": idreserva,
                "item_origem": item_id,
                "item_novo": novo_id,
                "status_origem": serde_json::to_value(item.status).ok(),
            })),
        );
        tracing::info!(
            ator = ator.id,
            item = item_id,
            novo = novo_id,
            idreserva,
            "reenvio manual de comunicação"
        );
        Ok(self.fila.buscar(novo_id).await?.unwrap_or(item))
    }

    /// Payload do template pós-reserva — mesmo formato dos demais
    /// envios (`assunto`+`html` p/ e-mail, `texto` p/ WhatsApp).
    fn corpo_pos_reserva(&self, r: &ReservaPosReserva, template: &str) -> serde_json::Value {
        let (assunto, texto) = match template {
            TPL_RESERVA_CONFIRMADA => (
                format!("Reserva confirmada — {}", self.pousada),
                self.texto_confirmada(r),
            ),
            TPL_RESERVA_CANCELADA => (
                format!("Reserva cancelada — {}", self.pousada),
                self.texto_cancelada(r),
            ),
            _ => (
                format!("Recebemos sua reserva — {}", self.pousada),
                self.texto_aguardando(r),
            ),
        };
        serde_json::json!({
            "assunto": assunto,
            "html": self.html_pos_reserva(&texto),
            "tipo": "texto",
            "texto": texto,
        })
    }

    /// "Sua reserva foi registrada" — pagamento pendente (link + prazo)
    /// ou aguardando análise da recepção, conforme o estado.
    fn texto_aguardando(&self, r: &ReservaPosReserva) -> String {
        let mut s = format!(
            "Olá, {}! Recebemos sua reserva na {}.\n\n\
             Reserva Nº #{}\n\
             Check-in: {}\n\
             Check-out: {} ({})\n\
             Acomodação: {}\n\
             Hóspedes: {}\n\
             Total: {}",
            primeiro_nome(&r.cliente_nome),
            self.pousada,
            r.idreserva,
            r.entradaprevista.format("%d/%m/%Y"),
            r.saidaprevista.format("%d/%m/%Y"),
            rotulo_diarias(r.entradaprevista, r.saidaprevista),
            r.acomodacao_nome.as_deref().unwrap_or("acomodação"),
            r.quantidade_hospedes,
            brl_decimal(r.valor_total),
        );
        if r.pendente_centavos > 0 {
            let _ = write!(
                s,
                "\n\nPagamento pendente: {}",
                brl_centavos(r.pendente_centavos)
            );
            if let Some(exp) = r.expira_em {
                let _ = write!(
                    s,
                    "\nSua acomodação fica garantida até {}.",
                    exp.format("%d/%m/%Y às %H:%M (UTC)")
                );
            }
        } else {
            s += "\n\nNossa recepção vai analisar e confirmar em seguida.";
        }
        if let Some(link) = self.link_portal(r) {
            let _ = write!(s, "\n\nAcompanhe sua reserva: {link}");
        }
        s += "\nQualquer dúvida, responda esta mensagem.";
        s
    }

    /// "Reserva confirmada" — dados completos da estadia + valores.
    fn texto_confirmada(&self, r: &ReservaPosReserva) -> String {
        let mut s = format!(
            "Olá, {}! Sua reserva na {} está CONFIRMADA.\n\n\
             Reserva Nº #{}\n\
             Check-in: {}\n\
             Check-out: {} ({})\n\
             Acomodação: {}\n\
             Hóspedes: {}\n\
             Total: {}",
            primeiro_nome(&r.cliente_nome),
            self.pousada,
            r.idreserva,
            r.entradaprevista.format("%d/%m/%Y"),
            r.saidaprevista.format("%d/%m/%Y"),
            rotulo_diarias(r.entradaprevista, r.saidaprevista),
            r.acomodacao_nome.as_deref().unwrap_or("acomodação"),
            r.quantidade_hospedes,
            brl_decimal(r.valor_total),
        );
        if r.pago_centavos > 0 {
            let restante = (r.valor_total * rust_decimal::Decimal::from(100))
                .round()
                .to_string()
                .parse::<i64>()
                .unwrap_or(0)
                .saturating_sub(r.pago_centavos);
            let _ = write!(s, "\nPago: {}", brl_centavos(r.pago_centavos));
            if restante > 0 {
                let _ = write!(s, " | Restante: {}", brl_centavos(restante));
            }
        }
        if let Some(link) = self.link_portal(r) {
            let _ = write!(s, "\n\nDetalhes da estadia: {link}");
        }
        s += "\nQualquer dúvida, responda esta mensagem.";
        s
    }

    /// "Reserva cancelada" — motivo genérico (manual ou hold expirado).
    fn texto_cancelada(&self, r: &ReservaPosReserva) -> String {
        let mut s = format!(
            "Olá, {}. Sua reserva Nº #{} na {} ({} a {}) foi cancelada.",
            primeiro_nome(&r.cliente_nome),
            r.idreserva,
            self.pousada,
            r.entradaprevista.format("%d/%m/%Y"),
            r.saidaprevista.format("%d/%m/%Y"),
        );
        if r.expira_em.is_some() && r.pago_centavos == 0 {
            let _ = write!(
                s,
                "\n\nSe expirou o prazo de pagamento, você pode reservar novamente em {}/reservar",
                self.site_base
            );
        }
        if let Some(link) = self.link_portal(r) {
            let _ = write!(s, "\nDetalhes: {link}");
        }
        s += "\nQualquer dúvida, responda esta mensagem.";
        s
    }

    /// Link seguro do portal do hóspede — token UUID não-enumerável
    /// (adivinhar o Nº da reserva não revela nada).
    fn link_portal(&self, r: &ReservaPosReserva) -> Option<String> {
        r.token_publico
            .map(|t| format!("{}/portal/{}", self.site_base, t))
    }

    /// Envelope HTML simples — quebras de linha viram <br> (mesmo
    /// padrão dos demais e-mails transacionais do módulo).
    fn html_pos_reserva(&self, texto: &str) -> String {
        let corpo = texto
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('\n', "<br>");
        format!(
            "<div style='font-family:sans-serif;max-width:560px;margin:0 auto'>\
             <h2 style='color:#054054'>{}</h2><p style='font-size:15px;line-height:1.55'>{corpo}</p>\
             <p><small>{}</small></p></div>",
            self.pousada, self.pousada
        )
    }

    // ------------------------------------------------------------------
    // avaliações — público (token) e admin
    // ------------------------------------------------------------------

    pub async fn avaliacao_publica(&self, token: uuid::Uuid) -> AppResult<Avaliacao> {
        let av = self.avaliacoes.por_token(token).await?;
        match av.status {
            StatusAvaliacao::Pendente | StatusAvaliacao::Respondida => Ok(av),
            StatusAvaliacao::Expirada => Err(DomainError::regra("avaliação expirada").into()),
        }
    }

    pub async fn responder_avaliacao_hospede(
        &self,
        token: uuid::Uuid,
        input: &RespostaAvaliacaoInput,
    ) -> AppResult<()> {
        if !(1..=5).contains(&input.nota_geral) {
            return Err(DomainError::validacao("nota_geral deve ser 1–5").into());
        }
        let av = self.avaliacoes.por_token(token).await?;
        self.avaliacoes
            .gravar_resposta_hospede(
                av.id,
                &RespostaAvaliacao {
                    nota_geral: input.nota_geral,
                    nota_limpeza: input.nota_limpeza,
                    nota_atendimento: input.nota_atendimento,
                    nota_custo: input.nota_custo,
                    nota_localizacao: input.nota_localizacao,
                    nps: input.nps,
                    comentario: input.comentario.clone(),
                },
            )
            .await?;
        // Alerta imediato pra equipe quando a nota dói (≤2 geral ou NPS ≤6).
        if input.nota_geral <= 2 || input.nps.is_some_and(|n| n <= 6) {
            let _ = self
                .avisar_equipe(
                    "avaliacao.critica",
                    "Avaliação crítica recebida",
                    &format!(
                        "Reserva #{}: nota geral {} — responder no CRM.",
                        av.idreserva, input.nota_geral
                    ),
                    Some(av.idreserva),
                )
                .await;
        }
        Ok(())
    }

    // ------------------------------------------------------------------
    // pré-ficha FNRH pública
    // ------------------------------------------------------------------

    pub async fn pre_ficha(&self, token: uuid::Uuid) -> AppResult<Option<ReservaAuto>> {
        Ok(self.automacao.reserva_publica_por_token(token).await?)
    }

    pub async fn gravar_pre_ficha(
        &self,
        token: uuid::Uuid,
        dados: &serde_json::Value,
    ) -> AppResult<()> {
        let r = self
            .automacao
            .reserva_publica_por_token(token)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("reserva não encontrada"))?;
        self.automacao.gravar_pre_ficha(r.idreserva, dados).await?;
        self.avisar_equipe(
            "reserva.fnrh_preenchida",
            "Pré-ficha preenchida",
            &format!(
                "{} completou a ficha da reserva #{}.",
                r.cliente_nome, r.idreserva
            ),
            Some(r.idreserva),
        )
        .await?;
        Ok(())
    }

    // ------------------------------------------------------------------
    // push subscriptions
    // ------------------------------------------------------------------

    pub async fn gravar_subscription(&self, sub: &PushSubscription) -> AppResult<()> {
        Ok(self.push.gravar(sub).await?)
    }

    pub async fn remover_subscription(&self, endpoint: &str) -> AppResult<()> {
        Ok(self.push.remover(endpoint).await?)
    }

    // ------------------------------------------------------------------
    // admin — listagem/monitor
    // ------------------------------------------------------------------

    pub async fn listar_fila(&self, limite: i64) -> AppResult<Vec<ItemFila>> {
        Ok(self.fila.listar(limite).await?)
    }

    pub async fn listar_matriz(&self) -> AppResult<Vec<RegraMatriz>> {
        Ok(self.fila.listar_matriz().await?)
    }

    pub async fn gravar_regra(&self, regra: &RegraMatriz) -> AppResult<()> {
        Ok(self.fila.gravar_regra(regra).await?)
    }

    /// Webhook Resend — bounce/complaint entra na supressão na hora.
    pub async fn suprimir_email(&self, email: &str, motivo: &str) -> AppResult<()> {
        Ok(self.fila.suprimir_email(email, motivo).await?)
    }

    /// Reserva enxuta por id — cobrança manual da recepção.
    pub async fn reserva_auto_publica(&self, idreserva: i64) -> AppResult<Option<ReservaAuto>> {
        Ok(self.automacao.reserva_por_id(idreserva).await?)
    }

    // ------------------------------------------------------------------
    // templates HTML (e-mail do hóspede — texto claro, sem dependências)
    // ------------------------------------------------------------------

    fn html_equipe(assunto: &str, mensagem: &str, pousada: &str) -> String {
        format!(
            "<div style='font-family:sans-serif;max-width:560px'>\
             <h2 style='color:#1a6f8a'>{assunto}</h2><p>{mensagem}</p>\
             <hr><small>{pousada} — notificação interna</small></div>"
        )
    }

    fn html_fnrh(&self, r: &ReservaAuto, link: &str) -> String {
        format!(
            "<div style='font-family:sans-serif;max-width:560px'>\
             <h2 style='color:#1a6f8a'>Complete sua ficha de hospedagem</h2>\
             <p>Olá, {}! Seu check-in em {} está chegando. Preencha a ficha \
             agora e chegue só para descansar:</p>\
             <p><a href='{link}' style='background:#1a6f8a;color:#fff;padding:12px 24px;\
             border-radius:8px;text-decoration:none;display:inline-block'>Preencher ficha</a></p>\
             <p><small>{} — check-in {}{}</small></p></div>",
            primeiro_nome(&r.cliente_nome),
            r.entradaprevista.format("%d/%m/%Y"),
            self.pousada,
            r.entradaprevista.format("%d/%m"),
            r.acomodacao_nome
                .as_ref()
                .map_or_default(|n| format!(" — {n}"))
        )
    }

    fn html_checkout(&self, r: &ReservaAuto, link: &str) -> String {
        format!(
            "<div style='font-family:sans-serif;max-width:560px'>\
             <h2 style='color:#1a6f8a'>Hoje é seu check-out</h2>\
             <p>Olá, {}! Lembrete: a liberação do quarto é até o horário \
             combinado. Precisa de mais tempo? Fale com a recepção:</p>\
             <p><a href='{link}' style='background:#1a6f8a;color:#fff;padding:12px 24px;\
             border-radius:8px;text-decoration:none;display:inline-block'>Check-out online</a></p>\
             <p><small>{}</small></p></div>",
            primeiro_nome(&r.cliente_nome),
            self.pousada
        )
    }

    fn html_cobranca(&self, r: &ReservaAuto, link: &str) -> String {
        format!(
            "<div style='font-family:sans-serif;max-width:560px'>\
             <h2 style='color:#1a6f8a'>Pagamento da sua reserva</h2>\
             <p>Olá, {}! Para confirmar sua reserva em {}, finalize o \
             pagamento pelo link seguro:</p>\
             <p><a href='{link}' style='background:#1a6f8a;color:#fff;padding:12px 24px;\
             border-radius:8px;text-decoration:none;display:inline-block'>Pagar agora</a></p>\
             <p><small>{}</small></p></div>",
            primeiro_nome(&r.cliente_nome),
            r.entradaprevista.format("%d/%m"),
            self.pousada
        )
    }

    fn html_pesquisa(&self, r: &ReservaAuto, link: &str, lembrete: bool) -> String {
        let intro = if lembrete {
            "Ainda dá tempo de contar como foi!"
        } else {
            "Obrigado por se hospedar conosco!"
        };
        format!(
            "<div style='font-family:sans-serif;max-width:560px'>\
             <h2 style='color:#1a6f8a'>{intro}</h2>\
             <p>Olá, {}! Em 1 minuto, sua avaliação ajuda a melhorar a \
             pousada e orienta outros hóspedes:</p>\
             <p><a href='{link}' style='background:#1a6f8a;color:#fff;padding:12px 24px;\
             border-radius:8px;text-decoration:none;display:inline-block'>Avaliar estadia</a></p>\
             <p><small>{}</small></p></div>",
            primeiro_nome(&r.cliente_nome),
            self.pousada
        )
    }
}

fn primeiro_nome(nome: &str) -> &str {
    nome.split_whitespace().next().unwrap_or(nome)
}

/// Chave idempotente da intenção pós-reserva — uma por transição,
/// canal e versão de template. Reenvios manuais sufixam `:re{id}`.
fn dedup_pos_reserva(idreserva: i64, template: &str, canal: CanalEnvio) -> String {
    format!(
        "pos:{}:{}:{}:v{}",
        idreserva,
        template,
        canal_rotulo(canal),
        VERSAO_POS_RESERVA
    )
}

fn canal_rotulo(canal: CanalEnvio) -> &'static str {
    match canal {
        CanalEnvio::Email => "email",
        CanalEnvio::Whatsapp => "whatsapp",
        CanalEnvio::Push => "push",
        CanalEnvio::Inbox => "inbox",
    }
}

/// "3 diárias" / "1 diária" — rótulo das noites entre entrada e saída.
fn rotulo_diarias(entrada: chrono::NaiveDate, saida: chrono::NaiveDate) -> String {
    let n = (saida - entrada).num_days().max(1);
    if n == 1 {
        "1 diária".into()
    } else {
        format!("{n} diárias")
    }
}

/// Centavos → "R$ 1.234,56" (formato brasileiro, sem símbolo de milhar faltando).
fn brl_centavos(centavos: i64) -> String {
    let neg = centavos < 0;
    let v = centavos.unsigned_abs();
    let inteiro = v / 100;
    let cent = v % 100;
    let milhar = {
        let s = inteiro.to_string();
        let mut out = String::with_capacity(s.len() + 4);
        for (i, c) in s.chars().enumerate() {
            if i > 0 && (s.len() - i).is_multiple_of(3) {
                out.push('.');
            }
            out.push(c);
        }
        out
    };
    format!("{}R$ {milhar},{cent:02}", if neg { "-" } else { "" })
}

/// Decimal → "R$ 1.234,56" (arredonda para centavos).
fn brl_decimal(v: rust_decimal::Decimal) -> String {
    let centavos = (v * rust_decimal::Decimal::from(100))
        .round()
        .to_string()
        .parse::<i64>()
        .unwrap_or(0);
    brl_centavos(centavos)
}

// ===========================================================================
// avaliações — visão administrativa
// ===========================================================================

pub struct AvaliacoesService {
    avaliacoes: Arc<dyn AvaliacaoRepository>,
}

impl AvaliacoesService {
    pub fn new(avaliacoes: Arc<dyn AvaliacaoRepository>) -> Self {
        Self { avaliacoes }
    }

    pub async fn listar(
        &self,
        status: Option<StatusAvaliacao>,
        limite: i64,
    ) -> AppResult<Vec<Avaliacao>> {
        Ok(self.avaliacoes.listar(status, limite).await?)
    }

    pub async fn responder(&self, id: i64, resposta: &str, ator: &Ator) -> AppResult<()> {
        ator.exigir_gerencial()?;
        self.avaliacoes.responder(id, resposta, ator.id).await?;
        Ok(())
    }

    /// Dashboard: médias por categoria, NPS, distribuição por plataforma.
    pub async fn dashboard(&self) -> AppResult<serde_json::Value> {
        let todas = self.avaliacoes.listar(None, 1000).await?;
        let respondidas: Vec<&Avaliacao> = todas
            .iter()
            .filter(|a| a.status == StatusAvaliacao::Respondida)
            .collect();
        let n = respondidas.len() as f64;
        let media_de = |sel: fn(&Avaliacao) -> Option<i16>| -> Option<f64> {
            let xs: Vec<f64> = respondidas
                .iter()
                .filter_map(|a| sel(a).map(|v| v as f64))
                .collect();
            (!xs.is_empty()).then(|| xs.iter().sum::<f64>() / xs.len() as f64)
        };
        let mut plataformas = serde_json::Map::new();
        for a in &respondidas {
            let e = plataformas
                .entry(a.plataforma.clone())
                .or_insert(serde_json::json!({"total":0,"soma":0}));
            e["total"] = serde_json::json!(e["total"].as_i64().unwrap_or(0) + 1);
            e["soma"] = serde_json::json!(
                e["soma"].as_i64().unwrap_or(0) + a.nota_geral.unwrap_or(0) as i64
            );
        }
        let nps: Vec<i16> = respondidas.iter().filter_map(|a| a.nps).collect();
        let nps_score = if nps.is_empty() {
            None
        } else {
            let promotores = nps.iter().filter(|&&v| v >= 9).count() as f64;
            let detratores = nps.iter().filter(|&&v| v <= 6).count() as f64;
            Some(((promotores - detratores) / nps.len() as f64) * 100.0)
        };
        Ok(serde_json::json!({
            "total": todas.len(),
            "respondidas": respondidas.len(),
            "taxa_resposta": if n > 0.0 { respondidas.len() as f64 / todas.len().max(1) as f64 } else { 0.0 },
            "media_geral": media_de(|a| a.nota_geral),
            "media_limpeza": media_de(|a| a.nota_limpeza),
            "media_atendimento": media_de(|a| a.nota_atendimento),
            "media_custo": media_de(|a| a.nota_custo),
            "media_localizacao": media_de(|a| a.nota_localizacao),
            "nps": nps_score,
            "plataformas": plataformas,
        }))
    }
}

// ===========================================================================
// fidelidade
// ===========================================================================

pub struct FidelidadeService {
    fidelidade: Arc<dyn FidelidadeRepository>,
}

impl FidelidadeService {
    pub fn new(fidelidade: Arc<dyn FidelidadeRepository>) -> Self {
        Self { fidelidade }
    }

    pub async fn niveis(&self) -> AppResult<Vec<NivelFidelidade>> {
        Ok(self.fidelidade.niveis().await?)
    }

    pub async fn gravar_nivel(&self, nivel: &NivelFidelidade, ator: &Ator) -> AppResult<i64> {
        ator.exigir_gerencial()?;
        Ok(self.fidelidade.gravar_nivel(nivel).await?)
    }

    pub async fn remover_nivel(&self, id: i64, ator: &Ator) -> AppResult<()> {
        ator.exigir_gerencial()?;
        Ok(self.fidelidade.remover_nivel(id).await?)
    }

    pub async fn do_cliente(&self, idcliente: i64) -> AppResult<Option<FidelidadeCliente>> {
        Ok(self.fidelidade.do_cliente(idcliente).await?)
    }

    pub async fn recomputar(&self, idcliente: i64) -> AppResult<()> {
        Ok(self.fidelidade.recomputar(idcliente).await?)
    }

    /// Perfil 360 — KPIs do hóspede + fidelidade numa resposta.
    pub async fn perfil360(&self, idcliente: i64) -> AppResult<serde_json::Value> {
        let kpis = self.fidelidade.kpis_cliente(idcliente).await?;
        let fid = self.fidelidade.do_cliente(idcliente).await?;
        Ok(serde_json::json!({ "kpis": kpis, "fidelidade": fid }))
    }
}
