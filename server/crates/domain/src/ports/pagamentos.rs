//! Portas do módulo de pagamentos online (Stripe).
//!
//! `PagamentoRepository` — persistência transacional (entidade + tentativa +
//! auditoria num commit, no padrão dos demais repositórios).
//! `PaymentGateway` — abstração do provedor; a implementação Stripe vive em
//! infrastructure e os testes usam um fake — cobrança real nunca ocorre fora
//! de produção.

use crate::entities::{
    NovaAuditoriaPagamento, PagamentoOnline, ReembolsoPagamento, TentativaPagamento, WebhookEvento,
};
use crate::enums::{StatusPagamento, StatusProcWebhook, StatusReembolso, TipoPagamento};
use crate::error::DomainError;
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use clarituz_shared::{Page, PageParams};
use serde::Serialize;
use serde_json::Value as JsonValue;
use uuid::Uuid;

// ---------------------------------------------------------------------------
// inputs / views
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct NovoPagamento {
    pub idreserva: i64,
    pub tipo: TipoPagamento,
    pub valor_centavos: i64,
}

#[derive(Debug, Clone)]
pub struct NovaTentativa {
    pub idpagamento: i64,
    pub session_id: String,
    pub session_url: Option<String>,
    pub expires_em: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct NovoEventoWebhook {
    pub event_id: String,
    pub event_type: String,
    pub payload: JsonValue,
}

/// Linha da listagem admin — pagamento + contexto mínimo da reserva.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct PagamentoView {
    pub id: i64,
    pub idreserva: i64,
    pub tipo: TipoPagamento,
    pub status: StatusPagamento,
    pub valor_centavos: i64,
    pub metodo: Option<String>,
    pub paid_em: Option<DateTime<Utc>>,
    pub criado_em: DateTime<Utc>,
    pub cliente_nome: String,
    pub acomodacao_nome: String,
    pub reembolsado_centavos: i64,
}

#[derive(Debug, Clone, Default)]
pub struct FiltroPagamento {
    pub inicio: Option<chrono::NaiveDate>,
    pub fim: Option<chrono::NaiveDate>,
    pub status: Option<StatusPagamento>,
    pub metodo: Option<String>,
    pub idreserva: Option<i64>,
    pub busca: Option<String>, // nome do cliente ou nº da reserva
}

/// Indicadores do painel financeiro (período sobre `paid_em`/`criado_em`).
#[derive(Debug, Clone, Default, Serialize, sqlx::FromRow)]
pub struct ResumoFinanceiro {
    pub recebido_centavos: i64,
    pub pendente_centavos: i64,
    pub reembolsado_centavos: i64,
    pub total_pagos: i64,
    pub total_pendentes: i64,
    pub total_recusados: i64,
    pub card_centavos: i64,
    pub pix_centavos: i64,
}

/// Receita por acomodação (drill-down do painel).
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct ReceitaAcomodacao {
    pub idacomodacao: i64,
    pub nome: String,
    pub recebido_centavos: i64,
    pub total_pagos: i64,
}

// ---------------------------------------------------------------------------
// gateway (provedor) — implementado por StripeAdapter + fakes de teste
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct NovaCheckout {
    /// Correlaciona a sessão ao nosso pagamento nos metadados Stripe.
    pub idpagamento: i64,
    pub idreserva: i64,
    pub descricao: String,
    pub valor_centavos: i64,
    /// 'integral' | 'sinal' | 'saldo' — o Stripe recebe via metadata.
    pub tipo: TipoPagamento,
    /// Expiração do hold — a sessão morre junto (Stripe exige 30min–24h).
    pub expires_em: DateTime<Utc>,
    pub success_url: String,
    pub cancel_url: String,
    /// Chave de idempotência enviada ao provedor (retry-safe).
    pub idempotency_key: Uuid,
}

#[derive(Debug, Clone)]
pub struct SessaoCheckout {
    pub session_id: String,
    pub url: String,
    pub expires_em: DateTime<Utc>,
    /// Presente quando o provedor já criou o PaymentIntent junto à sessão.
    pub pi_id: Option<String>,
}

/// Estado normalizado do PaymentIntent (o domínio não conhece os enums Stripe).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StatusPi {
    Pago,
    Processando, // Pix aguardando compensação
    RequerAcao,  // 3DS / aguardando ação do cliente
    Falhou,
    Cancelado,
}

#[async_trait]
pub trait PaymentGateway: Send + Sync {
    /// Cria sessão de checkout hospedada — redireciona o hóspede ao provedor.
    async fn criar_checkout(&self, nova: &NovaCheckout) -> Result<SessaoCheckout, DomainError>;

    /// Consulta o estado atual do PaymentIntent (reconciliação/polling).
    async fn status_payment_intent(&self, pi_id: &str) -> Result<StatusPi, DomainError>;

    /// Solicita reembolso parcial/integral. Retorna o `re_...` do provedor.
    async fn reembolsar(
        &self,
        pi_id: &str,
        valor_centavos: i64,
        motivo: Option<&str>,
        idempotency_key: Uuid,
    ) -> Result<String, DomainError>;

    /// Expira uma sessão de checkout aberta (cancelamento de hold).
    async fn expirar_sessao(&self, session_id: &str) -> Result<(), DomainError>;
}

// ---------------------------------------------------------------------------
// repositório — transações atômicas por operação de negócio
// ---------------------------------------------------------------------------

#[async_trait]
pub trait PagamentoRepository: Send + Sync {
    async fn buscar(&self, id: i64) -> Result<Option<PagamentoOnline>, DomainError>;
    async fn buscar_por_pi(&self, pi_id: &str) -> Result<Option<PagamentoOnline>, DomainError>;
    /// Localiza o pagamento dono de uma sessão de checkout (webhook).
    async fn buscar_por_session(
        &self,
        session_id: &str,
    ) -> Result<Option<PagamentoOnline>, DomainError>;
    async fn listar_da_reserva(&self, idreserva: i64) -> Result<Vec<PagamentoOnline>, DomainError>;

    /// Cria pagamento + auditoria ('criado') num commit.
    async fn criar(&self, novo: &NovoPagamento) -> Result<PagamentoOnline, DomainError>;

    /// Registra uma tentativa (sessão Stripe) no pagamento.
    async fn registrar_tentativa(
        &self,
        tentativa: &NovaTentativa,
    ) -> Result<TentativaPagamento, DomainError>;

    async fn marcar_tentativa_status(
        &self,
        session_id: &str,
        status: &str,
    ) -> Result<(), DomainError>;

    /// Tentativa ainda utilizável (aberta, dentro do prazo) — reuso
    /// idempotente do checkout quando o hóspede re-clica "pagar".
    async fn tentativa_aberta(
        &self,
        idpagamento: i64,
    ) -> Result<Option<TentativaPagamento>, DomainError>;

    /// Pagamentos 'pendente' com `pi_id` conhecido — reconciliador de
    /// webhooks perdidos consulta o provedor por eles.
    async fn pendentes_com_pi(&self, limite: i64) -> Result<Vec<PagamentoOnline>, DomainError>;

    /// Confirma o pagamento (webhook `completed`): status=pago + pi + método +
    /// auditoria ('pago') num commit. Idempotente — se já `pago`, é no-op.
    async fn confirmar_pago(
        &self,
        idpagamento: i64,
        pi_id: &str,
        metodo: Option<&str>,
        auditoria: NovaAuditoriaPagamento,
    ) -> Result<(), DomainError>;

    /// Transição genérica de status com auditoria (expirado/falhou/cancelado).
    async fn marcar_status(
        &self,
        idpagamento: i64,
        status: StatusPagamento,
        auditoria: NovaAuditoriaPagamento,
    ) -> Result<(), DomainError>;

    // -- reembolso -----------------------------------------------------------

    /// Registra o pedido de reembolso (pendente) + auditoria num commit.
    async fn criar_reembolso(
        &self,
        idpagamento: i64,
        valor_centavos: i64,
        motivo: Option<&str>,
        auditoria: NovaAuditoriaPagamento,
    ) -> Result<ReembolsoPagamento, DomainError>;

    async fn atualizar_reembolso(
        &self,
        id: i64,
        refund_id: &str,
        status: StatusReembolso,
    ) -> Result<(), DomainError>;

    async fn listar_reembolsos(
        &self,
        idpagamento: i64,
    ) -> Result<Vec<ReembolsoPagamento>, DomainError>;

    /// Soma dos reembolsos concluídos/pendentes — limite para novos reembolsos.
    async fn total_reembolsado(&self, idpagamento: i64) -> Result<i64, DomainError>;

    /// Recalcula o status do pagamento após reembolso (parcial|integral).
    async fn refletir_reembolso(
        &self,
        idpagamento: i64,
        auditoria: NovaAuditoriaPagamento,
    ) -> Result<(), DomainError>;

    // -- webhook inbox --------------------------------------------------------

    /// Insere o evento; retorna `false` se o event_id já existia (duplicado).
    async fn registrar_evento(&self, evento: &NovoEventoWebhook) -> Result<bool, DomainError>;

    async fn marcar_evento(
        &self,
        event_id: &str,
        status: StatusProcWebhook,
        erro: Option<&str>,
    ) -> Result<(), DomainError>;

    /// Eventos pendentes/retry para o sweeper de conciliação.
    async fn eventos_pendentes(&self, limite: i64) -> Result<Vec<WebhookEvento>, DomainError>;

    // -- conciliação de holds --------------------------------------------------

    /// Reservas 'p' do site com hold vencido (expira_em < now) — retorna
    /// (idreserva, idpagamento_aberto) para cancelamento coordenado.
    async fn holds_expirados(&self, limite: i64) -> Result<Vec<(i64, Option<i64>)>, DomainError>;

    /// Cancela a reserva vencida + expira pagamento/tentativas abertas + audit.
    async fn expirar_hold(
        &self,
        idreserva: i64,
        idpagamento: Option<i64>,
    ) -> Result<(), DomainError>;

    // -- admin / painel --------------------------------------------------------

    async fn listar(
        &self,
        filtro: &FiltroPagamento,
        page: PageParams,
    ) -> Result<Page<PagamentoView>, DomainError>;

    async fn resumo(
        &self,
        inicio: chrono::NaiveDate,
        fim: chrono::NaiveDate,
    ) -> Result<ResumoFinanceiro, DomainError>;

    async fn receita_por_acomodacao(
        &self,
        inicio: chrono::NaiveDate,
        fim: chrono::NaiveDate,
    ) -> Result<Vec<ReceitaAcomodacao>, DomainError>;

    /// Resolve reserva pelo token público opaco (fluxo do site — anti-enumeração).
    async fn reserva_por_token(&self, token: Uuid) -> Result<Option<i64>, DomainError>;
}
