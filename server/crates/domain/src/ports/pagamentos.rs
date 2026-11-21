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
    /// Identidade do provedor no lançamento — imutável.
    pub provedor: String,
    pub ambiente: Option<String>,
    pub idintegracao: Option<i64>,
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
    /// Dedup escopado por provedor — `evt_…` Stripe não colide com ids MP.
    pub provedor: String,
    pub event_id: String,
    pub event_type: String,
    pub payload: JsonValue,
    pub idintegracao: Option<i64>,
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
    /// Último motivo de recusa registrado na trilha (`status_detail` do
    /// provedor) — "Recusado" sozinho não explica nada pra recepção.
    pub motivo: Option<String>,
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
    /// Titular da reserva — antifraude do provedor pontua melhor com
    /// dados do pagador identificados (CPF + e-mail pesam muito no MP).
    pub pagador: Option<PagadorCheckout>,
    /// Webhook por-sessão (MP `notification_url`, PagBank
    /// `notification_urls`) — sem ele o provedor só avisa quem configurou
    /// o endpoint no painel deles. Stripe ignora (endpoint fixo no painel).
    pub notification_url: Option<String>,
}

/// Titular informado ao provedor — cada gateway mapeia o que suporta.
#[derive(Debug, Clone)]
pub struct PagadorCheckout {
    pub nome: String,
    /// CPF/CNPJ como persistido — o gateway normaliza para dígitos.
    pub documento: String,
    pub email: Option<String>,
    pub telefone: Option<String>,
}

#[derive(Debug, Clone)]
pub struct SessaoCheckout {
    pub session_id: String,
    pub url: String,
    pub expires_em: DateTime<Utc>,
    /// Presente quando o provedor já criou o PaymentIntent junto à sessão.
    pub pi_id: Option<String>,
}

/// Estado normalizado do pagamento no provedor (o domínio não conhece
/// os enums de cada gateway).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StatusPi {
    Pago,
    Processando, // Pix/boleto aguardando compensação
    RequerAcao,  // 3DS / aguardando ação do cliente
    Falhou,
    Cancelado,
}

/// Resultado de `consultar_pagamento` — estado autoritativo + a
/// correlação interna que o provedor devolveu.
#[derive(Debug, Clone)]
pub struct ConsultaPagamento {
    pub status: StatusPi,
    /// Referência interna (metadata/external_reference/reference_id) —
    /// o `idpagamento` quando o provedor o carrega.
    pub referencia: Option<String>,
    /// Referência de pagamento canônica no provedor — o que persistimos
    /// em `pi_id` (pi_…, charge CHAR_…, payment_id MP).
    pub id_provedor: Option<String>,
    /// Método liquidado ('card', 'pix', …) quando disponível.
    pub metodo: Option<String>,
    /// Motivo do provedor em recusa/falha — `status_detail` MP
    /// (`cc_rejected_high_risk`…), `payment_response.message` PagBank,
    /// `last_payment_error.message` Stripe. Vai para a auditoria —
    /// sem ele, "Recusado" na tela é um beco sem saída pra recepção.
    pub status_detail: Option<String>,
}

#[async_trait]
pub trait PaymentGateway: Send + Sync {
    /// Nome do provedor ('stripe'|'pagbank'|'mercadopago') — auditoria/log.
    fn provedor(&self) -> &'static str;

    /// Cria sessão de checkout hospedada — redireciona o hóspede ao provedor.
    async fn criar_checkout(&self, nova: &NovaCheckout) -> Result<SessaoCheckout, DomainError>;

    /// Consulta o estado autoritativo da referência de pagamento no
    /// provedor — fetch-back de webhooks e reconciliação. `ref_id` é o
    /// `pi_id` persistido — Stripe `pi_…`, PagBank `ORDE_…`/`CHAR_…`,
    /// MP `payment_id`.
    async fn consultar_pagamento(&self, ref_id: &str) -> Result<ConsultaPagamento, DomainError>;

    /// Solicita reembolso parcial/integral. Retorna o id do provedor.
    async fn reembolsar(
        &self,
        ref_id: &str,
        valor_centavos: i64,
        motivo: Option<&str>,
        idempotency_key: Uuid,
    ) -> Result<String, DomainError>;

    /// Expira uma sessão de checkout aberta (cancelamento de hold).
    /// Provedores sem API de expiração retornam erro explícito — a UI
    /// expõe isso via capability `checkout_expiravel`.
    async fn expirar_sessao(&self, session_id: &str) -> Result<(), DomainError>;

    /// Teste de conexão: leitura autenticada sem efeito financeiro.
    /// Retorna rótulo sanitizado da conta (ex.: `acct_…`, id de usuário).
    async fn testar_conexao(&self) -> Result<String, DomainError>;
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

    /// Última tentativa registrada, em qualquer estado — referência de
    /// reconciliação por `session_id` para provedor cujo pi ainda não
    /// chegou (ex.: Stripe pago com webhook atrasado/perdido).
    async fn ultima_tentativa(
        &self,
        idpagamento: i64,
    ) -> Result<Option<TentativaPagamento>, DomainError>;

    /// Pagamentos 'pendente' que o reconciliador consegue consultar no
    /// provedor: `pi_id` conhecido, Mercado Pago (a busca por
    /// `external_reference = idpagamento` cobre o Checkout Pro, cujo
    /// payment_id só chegaria via webhook), ou provedor com tentativa
    /// registrada — a `session_id` do checkout resolve o estado quando
    /// o pi ainda não foi gravado (Stripe pago sem webhook).
    async fn pendentes_reconciliaveis(
        &self,
        limite: i64,
    ) -> Result<Vec<PagamentoOnline>, DomainError>;

    /// Confirma o pagamento (webhook `completed`): status=pago + pi + método +
    /// auditoria ('pago') num commit. Idempotente — se já `pago`, é no-op.
    /// Idempotente — devolve `true` somente quando a transição para
    /// 'pago' realmente aconteceu nesta chamada (o chamador usa isso
    /// para disparar efeitos únicos, como a confirmação ao hóspede).
    async fn confirmar_pago(
        &self,
        idpagamento: i64,
        pi_id: &str,
        metodo: Option<&str>,
        auditoria: NovaAuditoriaPagamento,
    ) -> Result<bool, DomainError>;

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

    /// Insere o evento; retorna `false` se (provedor, event_id) já existia.
    async fn registrar_evento(&self, evento: &NovoEventoWebhook) -> Result<bool, DomainError>;

    async fn marcar_evento(
        &self,
        provedor: &str,
        event_id: &str,
        status: StatusProcWebhook,
        erro: Option<&str>,
    ) -> Result<(), DomainError>;

    /// Eventos pendentes/retry para o sweeper de conciliação.
    async fn eventos_pendentes(&self, limite: i64) -> Result<Vec<WebhookEvento>, DomainError>;

    /// Últimos eventos de uma integração — saúde do webhook na UI.
    async fn eventos_da_integracao(
        &self,
        idintegracao: i64,
        limite: i64,
    ) -> Result<Vec<WebhookEvento>, DomainError>;

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
