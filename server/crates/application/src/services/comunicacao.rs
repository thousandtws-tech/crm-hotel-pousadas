//! Comunicação com hóspedes e equipe — dispatcher da matriz, worker da
//! fila persistente, automações (FNRH/check-out/pesquisa/cobrança) e
//! reputação (avaliações, NPS). Senders são `Emissor` plugáveis — sem
//! credenciais configuradas o item falha e volta pra fila com backoff,
//! sem derrubar nada.

use std::sync::Arc;

use crate::actor::Ator;
use chrono::{Duration, Utc};
use clarituz_domain::entities::*;
use clarituz_domain::enums::{CanalEnvio, StatusAvaliacao};
use clarituz_domain::error::DomainError;
use clarituz_domain::events::{Aviso, TipoAviso};
use clarituz_domain::ports::*;

use crate::dto::RespostaAvaliacaoInput;
use crate::error::AppResult;

const MAX_LOTE: i64 = 50;
const LEMBRETE_DIAS: i64 = 3;
const EXPIRAR_AVALIACAO_DIAS: i64 = 14;

pub struct ComunicacaoService {
    fila: Arc<dyn FilaEnvioRepository>,
    push: Arc<dyn PushRepository>,
    avaliacoes: Arc<dyn AvaliacaoRepository>,
    automacao: Arc<dyn AutomacaoRepository>,
    emissores: Vec<Arc<dyn Emissor>>,
    eventos: Arc<dyn EventoPublisher>,
    /// Base pública dos links de hóspede — ex.: https://espiritodomar.com.br
    site_base: String,
    pousada: String,
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
        pousada: String,
    ) -> Self {
        Self {
            fila,
            push,
            avaliacoes,
            automacao,
            emissores,
            eventos,
            site_base: site_base.trim_end_matches('/').into(),
            pousada,
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
                Ok(provider_id) => {
                    self.fila.marcar_enviado(item.id, provider_id).await?;
                }
                Err(e) => {
                    let backoff = 60i64 * (1 << item.tentativas.min(5));
                    self.fila
                        .marcar_falha(item.id, &e.to_string(), backoff)
                        .await?;
                    tracing::warn!(id = item.id, erro = %e, "fila_envio: falha");
                }
            }
        }
        Ok(processados)
    }

    async fn enviar_item(&self, item: &ItemFila) -> Result<Option<String>, DomainError> {
        if item.canal == CanalEnvio::Email && self.fila.email_suprimido(&item.destino).await? {
            return Err(DomainError::regra("destino suprimido (bounce/complaint)"));
        }
        let emissor = self
            .emissores
            .iter()
            .find(|e| e.canal() == item.canal)
            .ok_or_else(|| DomainError::regra("canal sem emissor configurado"))?;
        emissor
            .enviar(&item.destino, &item.template, &item.payload)
            .await
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
        if let Some(fone) = &r.cliente_telefone {
            let _ = self
                .fila
                .enfileirar(NovoEnvio {
                    canal: CanalEnvio::Whatsapp,
                    destino: fone.clone(),
                    template: template.into(),
                    payload: corpo,
                    idreserva: Some(r.idreserva),
                    idcliente: Some(r.idcliente),
                    idfuncionario: None,
                    agendado_para: agora,
                })
                .await;
        }
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
                .map(|n| format!(" — {n}"))
                .unwrap_or_default()
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
