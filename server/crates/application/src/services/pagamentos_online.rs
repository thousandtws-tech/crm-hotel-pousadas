//! Casos de uso de pagamentos online (Stripe).
//!
//! Autoridade de valores: o servidor calcula `valor_centavos` a partir do
//! `valor_estadia` persistido — o site informa apenas *o quê* pagar
//! (integral|sinal|saldo), nunca *quanto*. A confirmação da reserva depende
//! exclusivamente de evidência do provedor (webhook validado ou consulta
//! direta na conciliação) — a página de sucesso é só cosmética.
//!
//! Idempotência em três camadas:
//! - sessão Stripe com `Idempotency-Key` (retry-safe no provedor);
//! - inbox `pagamento_webhook_evento.event_id` UNIQUE (evento duplicado é no-op);
//! - `confirmar_pago` guardado por `status != 'pago'` (efeito único).

use crate::actor::Ator;
use crate::dto::{
    CheckoutPublicoInput, CheckoutPublicoOutput, PagamentoResumoPublico, ReembolsarPagamentoInput,
    ReembolsoOutput, StatusPublicoOutput,
};
use crate::error::AppResult;
use clarituz_domain::entities::{NovaAuditoriaPagamento, PagamentoOnline, WebhookEvento};
use clarituz_domain::enums::{StatusPagamento, StatusProcWebhook, TipoPagamento};
use clarituz_domain::events::{Aviso, TipoAviso};
use clarituz_domain::ports::{
    EventoPublisher, FiltroPagamento, NovaCheckout, NovaTentativa, NovoEventoWebhook,
    NovoPagamento, PagamentoRepository, PagamentoView, PaymentGateway, ReceitaAcomodacao,
    ReservaRepository, ResumoFinanceiro, StatusPi,
};
use clarituz_domain::DomainError;
use clarituz_shared::{Page, PageParams};
use rust_decimal::Decimal;
use serde_json::json;
use std::sync::Arc;
use tracing::{info, instrument, warn};
use uuid::Uuid;

pub struct PagamentosOnlineService {
    pagamentos: Arc<dyn PagamentoRepository>,
    reservas: Arc<dyn ReservaRepository>,
    /// `None` quando `STRIPE_SECRET_KEY` não está configurada — o checkout
    /// público falha com erro explícito em vez de panic.
    gateway: Option<Arc<dyn PaymentGateway>>,
    eventos: Arc<dyn EventoPublisher>,
    sinal_percentual: u32,
    hold_minutos: i64,
    success_url: String,
    cancel_url: String,
}

impl PagamentosOnlineService {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        pagamentos: Arc<dyn PagamentoRepository>,
        reservas: Arc<dyn ReservaRepository>,
        gateway: Option<Arc<dyn PaymentGateway>>,
        eventos: Arc<dyn EventoPublisher>,
        sinal_percentual: u32,
        hold_minutos: i64,
        success_url: String,
        cancel_url: String,
    ) -> Self {
        Self {
            pagamentos,
            reservas,
            gateway,
            eventos,
            sinal_percentual,
            hold_minutos,
            success_url,
            cancel_url,
        }
    }

    fn gateway(&self) -> Result<&Arc<dyn PaymentGateway>, DomainError> {
        self.gateway
            .as_ref()
            .ok_or_else(|| DomainError::regra("Pagamento online indisponível no momento."))
    }

    // -- fluxo público (site) --------------------------------------------------

    /// Cria sessão de checkout para a reserva identificada pelo token
    /// público opaco. Recalcula o valor no servidor — o corpo da request
    /// nunca traz dinheiro.
    #[instrument(skip(self, input))]
    pub async fn criar_checkout_publico(
        &self,
        input: CheckoutPublicoInput,
    ) -> AppResult<CheckoutPublicoOutput> {
        let gateway = self.gateway()?;
        let idreserva = self
            .pagamentos
            .reserva_por_token(input.token)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Reserva não encontrada."))?;

        let reserva = self
            .reservas
            .buscar_detalhe(idreserva)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Reserva não encontrada."))?;

        if reserva.status != clarituz_domain::enums::StatusReserva::Pendente {
            return Err(
                DomainError::conflito("Esta reserva não está aguardando pagamento.").into(),
            );
        }
        if let Some(exp) = reserva_expira(&reserva) {
            if exp < chrono::Utc::now() {
                return Err(DomainError::conflito(
                    "O prazo de pagamento desta reserva expirou. Faça uma nova reserva.",
                )
                .into());
            }
        }

        let total = reserva
            .consumo
            .as_ref()
            .map(|c| c.valor_estadia)
            .filter(|v| *v > Decimal::ZERO)
            .ok_or_else(|| DomainError::regra("Reserva sem valor de estadia."))?;
        let total_centavos = centavos(total)?;
        let ja_pago = self.centavos_pagos(idreserva).await?;

        let (tipo, valor_centavos) = match input.tipo {
            TipoPagamento::Integral => (TipoPagamento::Integral, total_centavos - ja_pago),
            TipoPagamento::Sinal => {
                let sinal = total_centavos * i64::from(self.sinal_percentual) / 100;
                (TipoPagamento::Sinal, sinal)
            }
            TipoPagamento::Saldo => (TipoPagamento::Saldo, total_centavos - ja_pago),
        };
        if valor_centavos <= 0 {
            return Err(DomainError::regra("Não há saldo a pagar nesta reserva.").into());
        }

        // Reuso idempotente: pagamento cobrável do mesmo tipo com sessão
        // aberta devolve a URL existente — clique duplo não gera 2 sessões.
        for p in self.pagamentos.listar_da_reserva(idreserva).await? {
            if p.tipo == tipo && p.status == StatusPagamento::Pendente {
                if let Some(t) = self.pagamentos.tentativa_aberta(p.id).await? {
                    if let Some(url) = t.session_url.clone() {
                        return Ok(CheckoutPublicoOutput {
                            checkout_url: url,
                            valor_centavos: p.valor_centavos,
                            expira_em: t.expires_em,
                            idpagamento: p.id,
                        });
                    }
                }
            }
        }

        let pagamento = self
            .pagamentos
            .criar(&NovoPagamento {
                idreserva,
                tipo,
                valor_centavos,
            })
            .await?;

        let hold = chrono::Utc::now() + chrono::Duration::minutes(self.hold_minutos);
        let sessao = gateway
            .criar_checkout(&NovaCheckout {
                idpagamento: pagamento.id,
                idreserva,
                descricao: format!(
                    "Reserva #{} — {} ({} → {})",
                    reserva.id,
                    reserva.acomodacao_nome,
                    reserva.entradaprevista.format("%d/%m/%Y"),
                    reserva.saidaprevista.format("%d/%m/%Y")
                ),
                valor_centavos,
                tipo,
                expires_em: hold,
                // Retorno identificado pelo token opaco — nunca o id
                // sequencial, que seria enumerável na URL do site.
                success_url: format!("{}?token={}", self.success_url, input.token),
                cancel_url: format!("{}?token={}", self.cancel_url, input.token),
                idempotency_key: Uuid::new_v4(),
            })
            .await
            .inspect_err(|_| {
                warn!(
                    idpagamento = pagamento.id,
                    "stripe: falha ao criar checkout"
                );
            })?;

        self.pagamentos
            .registrar_tentativa(&NovaTentativa {
                idpagamento: pagamento.id,
                session_id: sessao.session_id,
                session_url: Some(sessao.url.clone()),
                expires_em: sessao.expires_em,
            })
            .await?;

        metrics::counter!("clarituz_pagamentos_checkout_criado_total").increment(1);
        Ok(CheckoutPublicoOutput {
            checkout_url: sessao.url,
            valor_centavos,
            expira_em: sessao.expires_em,
            idpagamento: pagamento.id,
        })
    }

    /// Status para a página pós-redirect — só leitura, sem efeito colateral.
    /// A confirmação real chega pelo webhook; esta rota apenas reflete o
    /// estado já persistido.
    pub async fn status_publico(&self, token: Uuid) -> AppResult<StatusPublicoOutput> {
        let idreserva = self
            .pagamentos
            .reserva_por_token(token)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Reserva não encontrada."))?;
        let reserva = self
            .reservas
            .buscar(idreserva)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Reserva não encontrada."))?;
        let pagamentos = self.pagamentos.listar_da_reserva(idreserva).await?;
        Ok(StatusPublicoOutput {
            status_reserva: reserva.status,
            confirmada: pagamentos.iter().any(|p| p.status == StatusPagamento::Pago),
            pagamentos: pagamentos
                .iter()
                .map(|p| PagamentoResumoPublico {
                    tipo: p.tipo,
                    status: p.status,
                    valor_centavos: p.valor_centavos,
                    metodo: p.metodo.clone(),
                })
                .collect(),
        })
    }

    /// Inbox idempotente — retorna `false` se o evento já existia.
    pub async fn registrar_evento(&self, evento: &NovoEventoWebhook) -> AppResult<bool> {
        let novo = self.pagamentos.registrar_evento(evento).await?;
        metrics::counter!("clarituz_pagamentos_webhook_recebidos_total").increment(1);
        if !novo {
            metrics::counter!("clarituz_pagamentos_webhook_duplicados_total").increment(1);
        }
        Ok(novo)
    }

    pub async fn marcar_evento(
        &self,
        event_id: &str,
        status: StatusProcWebhook,
        erro: Option<&str>,
    ) -> AppResult<()> {
        Ok(self
            .pagamentos
            .marcar_evento(event_id, status, erro)
            .await?)
    }

    // -- webhook (chamado pela rota após validar assinatura + inbox) -----------

    /// Despacha o evento persistido. Erros retornam para a rota marcar
    /// `falhou` e o sweeper re-tentar — evento nunca é perdido.
    #[instrument(skip(self, evento), fields(event_id = %evento.event_id, tipo = %evento.event_type))]
    pub async fn processar_evento(&self, evento: &WebhookEvento) -> AppResult<()> {
        let obj = &evento.payload["data"]["object"];
        match evento.event_type.as_str() {
            "checkout.session.completed" => {
                let session_id = obj["id"].as_str().unwrap_or_default();
                let pi_id = obj["payment_intent"].as_str().unwrap_or_default();
                let metodo = obj["payment_method_types"][0].as_str();
                self.confirmar_por_session(session_id, pi_id, metodo).await
            }
            "checkout.session.expired" => {
                let session_id = obj["id"].as_str().unwrap_or_default();
                self.expirar_por_session(session_id).await
            }
            "payment_intent.payment_failed" => {
                let pi_id = obj["id"].as_str().unwrap_or_default();
                self.falhar_por_pi(pi_id).await
            }
            "charge.refunded" => {
                let pi_id = obj["payment_intent"].as_str().unwrap_or_default();
                self.refletir_reembolso_por_pi(pi_id).await
            }
            _ => Ok(()), // evento fora do escopo → rota marca 'ignorado'
        }
    }

    async fn confirmar_por_session(
        &self,
        session_id: &str,
        pi_id: &str,
        metodo: Option<&str>,
    ) -> AppResult<()> {
        self.pagamentos
            .marcar_tentativa_status(session_id, "paga")
            .await?;
        let Some(p) = self.pagamentos.buscar_por_session(session_id).await? else {
            warn!(session_id, "webhook: sessão desconhecida");
            return Ok(());
        };
        if p.status.liquidado() {
            return Ok(()); // duplicado/fora de ordem — idempotente
        }
        self.pagamentos
            .confirmar_pago(
                p.id,
                pi_id,
                metodo,
                NovaAuditoriaPagamento {
                    idpagamento: p.id,
                    ator_tipo: "stripe",
                    ator_id: None,
                    acao: "pago",
                    dados: Some(json!({"session_id": session_id, "pi": pi_id})),
                },
            )
            .await?;
        metrics::counter!("clarituz_pagamentos_confirmados_total").increment(1);
        info!(
            idpagamento = p.id,
            idreserva = p.idreserva,
            "pagamento confirmado"
        );
        self.eventos.avisar(
            Aviso::novo(
                TipoAviso::Sucesso,
                "Pagamento confirmado",
                format!(
                    "Reserva #{} — pagamento de R$ {:.2} recebido ({}).",
                    p.idreserva,
                    p.valor_reais(),
                    metodo.unwrap_or("stripe")
                ),
            )
            .dados(json!({"idreserva": p.idreserva, "idpagamento": p.id})),
        );
        Ok(())
    }

    async fn expirar_por_session(&self, session_id: &str) -> AppResult<()> {
        self.pagamentos
            .marcar_tentativa_status(session_id, "expirada")
            .await?;
        let Some(p) = self.pagamentos.buscar_por_session(session_id).await? else {
            return Ok(());
        };
        // Se não resta tentativa aberta e o pagamento segue pendente → expirado.
        if p.status == StatusPagamento::Pendente
            && self.pagamentos.tentativa_aberta(p.id).await?.is_none()
        {
            self.pagamentos
                .marcar_status(
                    p.id,
                    StatusPagamento::Expirado,
                    NovaAuditoriaPagamento {
                        idpagamento: p.id,
                        ator_tipo: "stripe",
                        ator_id: None,
                        acao: "expirado",
                        dados: Some(json!({"session_id": session_id})),
                    },
                )
                .await?;
        }
        Ok(())
    }

    async fn falhar_por_pi(&self, pi_id: &str) -> AppResult<()> {
        let Some(p) = self.pagamentos.buscar_por_pi(pi_id).await? else {
            return Ok(());
        };
        if p.status.liquidado() {
            return Ok(());
        }
        self.pagamentos
            .marcar_status(
                p.id,
                StatusPagamento::Falhou,
                NovaAuditoriaPagamento {
                    idpagamento: p.id,
                    ator_tipo: "stripe",
                    ator_id: None,
                    acao: "falhou",
                    dados: Some(json!({"pi": pi_id})),
                },
            )
            .await?;
        metrics::counter!("clarituz_pagamentos_recusados_total").increment(1);
        self.eventos.avisar(
            Aviso::novo(
                TipoAviso::Alerta,
                "Pagamento recusado",
                format!(
                    "Reserva #{} — pagamento de R$ {:.2} foi recusado.",
                    p.idreserva,
                    p.valor_reais()
                ),
            )
            .dados(json!({"idreserva": p.idreserva, "idpagamento": p.id})),
        );
        Ok(())
    }

    /// `charge.refunded` — o refund Stripe já concluiu; espelhamos o estado.
    async fn refletir_reembolso_por_pi(&self, pi_id: &str) -> AppResult<()> {
        let Some(p) = self.pagamentos.buscar_por_pi(pi_id).await? else {
            return Ok(());
        };
        self.pagamentos
            .refletir_reembolso(
                p.id,
                NovaAuditoriaPagamento {
                    idpagamento: p.id,
                    ator_tipo: "stripe",
                    ator_id: None,
                    acao: "reembolso_confirmado",
                    dados: Some(json!({"pi": pi_id})),
                },
            )
            .await?;
        Ok(())
    }

    // -- conciliação (sweeper — chamado por task periódica) ---------------------

    /// 1) Holds vencidos → cancela reserva pendente + expira pagamento
    ///    (a constraint de overlap libera a acomodação na hora);
    /// 2) Eventos falhos → reprocessa com contador de tentativas;
    /// 3) Pagamentos 'pendente' com pi → consulta o provedor (recupera
    ///    webhook perdido — reconciliador do spec).
    pub async fn conciliar(&self) -> AppResult<()> {
        for (idreserva, idpagamento) in self.pagamentos.holds_expirados(50).await? {
            self.pagamentos.expirar_hold(idreserva, idpagamento).await?;
            info!(idreserva, "hold expirado — reserva cancelada");
            self.eventos.avisar(
                Aviso::novo(
                    TipoAviso::Info,
                    "Reserva expirada",
                    format!("Reserva #{idreserva} expirou sem pagamento e foi liberada."),
                )
                .dados(json!({"idreserva": idreserva})),
            );
        }

        for evento in self.pagamentos.eventos_pendentes(50).await? {
            match self.processar_evento(&evento).await {
                Ok(()) => {
                    self.pagamentos
                        .marcar_evento(&evento.event_id, StatusProcWebhook::Processado, None)
                        .await?;
                }
                Err(e) => {
                    warn!(event_id = %evento.event_id, erro = %e, "webhook retry falhou");
                    self.pagamentos
                        .marcar_evento(
                            &evento.event_id,
                            StatusProcWebhook::Falhou,
                            Some(&e.to_string()),
                        )
                        .await?;
                }
            }
        }

        // Reconciliador: pagamentos pendentes com pi conhecido — pergunta
        // ao provedor (cobre webhook perdido/fora de ordem definitivamente).
        if let Some(gateway) = &self.gateway {
            for p in self.pagamentos.pendentes_com_pi(50).await? {
                let Some(pi_id) = p.pi_id.clone() else {
                    continue;
                };
                match gateway.status_payment_intent(&pi_id).await {
                    Ok(StatusPi::Pago) => {
                        self.pagamentos
                            .confirmar_pago(
                                p.id,
                                &pi_id,
                                None,
                                NovaAuditoriaPagamento {
                                    idpagamento: p.id,
                                    ator_tipo: "sistema",
                                    ator_id: None,
                                    acao: "pago_conciliado",
                                    dados: Some(json!({"pi": pi_id})),
                                },
                            )
                            .await?;
                        info!(idpagamento = p.id, "pagamento confirmado via conciliação");
                    }
                    Ok(StatusPi::Cancelado) => {
                        self.pagamentos
                            .marcar_status(
                                p.id,
                                StatusPagamento::Cancelado,
                                NovaAuditoriaPagamento {
                                    idpagamento: p.id,
                                    ator_tipo: "sistema",
                                    ator_id: None,
                                    acao: "cancelado_conciliado",
                                    dados: Some(json!({"pi": pi_id})),
                                },
                            )
                            .await?;
                    }
                    Ok(_) => {}
                    Err(e) => warn!(idpagamento = p.id, erro = %e, "conciliação pi falhou"),
                }
            }
        }
        Ok(())
    }

    // -- admin -----------------------------------------------------------------

    /// Reembolso parcial/integral — exige permissão financeira.
    /// O valor é conferido contra `pago − reembolsado` antes de chamar o
    /// provedor; o reembolso Stripe é idempotente por chave derivada do
    /// pagamento (retry do admin não duplica cobrança reversa).
    #[instrument(skip(self, ator), fields(ator = %ator.login))]
    pub async fn reembolsar(
        &self,
        ator: &Ator,
        idpagamento: i64,
        input: ReembolsarPagamentoInput,
    ) -> AppResult<ReembolsoOutput> {
        ator.exigir_financeiro()?;
        let gateway = self.gateway()?;
        let p = self
            .pagamentos
            .buscar(idpagamento)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Pagamento não encontrado."))?;
        if !p.status.liquidado() {
            return Err(
                DomainError::regra("Só é possível reembolsar pagamento já confirmado.").into(),
            );
        }
        let pi_id = p
            .pi_id
            .clone()
            .ok_or_else(|| DomainError::regra("Pagamento sem identificador do provedor."))?;
        let ja = self.pagamentos.total_reembolsado(p.id).await?;
        let restante = p.valor_centavos - ja;
        if input.valor_centavos <= 0 || input.valor_centavos > restante {
            return Err(DomainError::validacao(format!(
                "Valor inválido — máximo reembolsável: R$ {:.2}.",
                restante as f64 / 100.0
            ))
            .into());
        }

        let reembolso = self
            .pagamentos
            .criar_reembolso(
                p.id,
                input.valor_centavos,
                input.motivo.as_deref(),
                NovaAuditoriaPagamento {
                    idpagamento: p.id,
                    ator_tipo: "funcionario",
                    ator_id: Some(ator.id),
                    acao: "reembolso_solicitado",
                    dados: Some(json!({
                        "valor_centavos": input.valor_centavos,
                        "motivo": input.motivo,
                        "ator": ator.login,
                    })),
                },
            )
            .await?;

        match gateway
            .reembolsar(
                &pi_id,
                input.valor_centavos,
                input.motivo.as_deref(),
                // Chave derivada — retry do admin reusa o mesmo reembolso.
                Uuid::new_v5(
                    &Uuid::NAMESPACE_OID,
                    format!("reembolso-{}", reembolso.id).as_bytes(),
                ),
            )
            .await
        {
            Ok(refund_id) => {
                self.pagamentos
                    .atualizar_reembolso(
                        reembolso.id,
                        &refund_id,
                        clarituz_domain::enums::StatusReembolso::Concluido,
                    )
                    .await?;
                self.pagamentos
                    .refletir_reembolso(
                        p.id,
                        NovaAuditoriaPagamento {
                            idpagamento: p.id,
                            ator_tipo: "funcionario",
                            ator_id: Some(ator.id),
                            acao: "reembolso_concluido",
                            dados: Some(json!({"refund_id": refund_id})),
                        },
                    )
                    .await?;
                metrics::counter!("clarituz_pagamentos_reembolsos_total").increment(1);
                info!(idpagamento = p.id, refund_id, "reembolso concluído");
                Ok(ReembolsoOutput {
                    id: reembolso.id,
                    refund_id: Some(refund_id),
                    status: "concluido".into(),
                })
            }
            Err(e) => {
                self.pagamentos
                    .atualizar_reembolso(
                        reembolso.id,
                        "",
                        clarituz_domain::enums::StatusReembolso::Falhou,
                    )
                    .await?;
                Err(e.into())
            }
        }
    }

    // -- leituras admin ---------------------------------------------------------

    pub async fn listar(
        &self,
        filtro: &FiltroPagamento,
        page: PageParams,
    ) -> AppResult<Page<PagamentoView>> {
        Ok(self.pagamentos.listar(filtro, page).await?)
    }

    pub async fn listar_da_reserva(&self, idreserva: i64) -> AppResult<Vec<PagamentoOnline>> {
        Ok(self.pagamentos.listar_da_reserva(idreserva).await?)
    }

    pub async fn listar_reembolsos(
        &self,
        idpagamento: i64,
    ) -> AppResult<Vec<clarituz_domain::entities::ReembolsoPagamento>> {
        Ok(self.pagamentos.listar_reembolsos(idpagamento).await?)
    }

    /// Visão financeira do período — restringe a gerência/admin.
    pub async fn resumo(
        &self,
        ator: &Ator,
        inicio: chrono::NaiveDate,
        fim: chrono::NaiveDate,
    ) -> AppResult<ResumoFinanceiro> {
        ator.exigir_gerencial()?;
        Ok(self.pagamentos.resumo(inicio, fim).await?)
    }

    pub async fn receita_por_acomodacao(
        &self,
        ator: &Ator,
        inicio: chrono::NaiveDate,
        fim: chrono::NaiveDate,
    ) -> AppResult<Vec<ReceitaAcomodacao>> {
        ator.exigir_gerencial()?;
        Ok(self.pagamentos.receita_por_acomodacao(inicio, fim).await?)
    }

    // -- internos ---------------------------------------------------------------

    /// Soma centavos dos pagamentos já liquidados na reserva (saldo restante).
    async fn centavos_pagos(&self, idreserva: i64) -> AppResult<i64> {
        Ok(self
            .pagamentos
            .listar_da_reserva(idreserva)
            .await?
            .iter()
            .filter(|p| p.status.liquidado())
            .map(|p| p.valor_centavos)
            .sum())
    }
}

/// Decimal BRL → centavos inteiros (x100, arredondado) — a fronteira onde
/// dinheiro deixa de ser Decimal e vira unidade mínima.
fn centavos(v: Decimal) -> AppResult<i64> {
    let c = (v * Decimal::from(100)).round();
    c.to_string()
        .parse::<i64>()
        .map_err(|_| DomainError::regra("Valor monetário inválido.").into())
}

fn reserva_expira(
    detalhe: &clarituz_domain::queries::ReservaDetalhe,
) -> Option<chrono::DateTime<chrono::Utc>> {
    detalhe.expira_em
}
