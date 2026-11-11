use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct CheckoutPublicoInput {
    /// Token público retornado na criação da reserva.
    pub token: uuid::Uuid,
    /// 'integral' | 'sinal' | 'saldo' — o valor é recalculado no servidor.
    pub tipo: clarituz_domain::enums::TipoPagamento,
}

#[derive(Debug, Serialize)]
pub struct CheckoutPublicoOutput {
    /// URL hospedada Stripe para onde o hóspede é redirecionado.
    pub checkout_url: String,
    pub valor_centavos: i64,
    pub expira_em: chrono::DateTime<chrono::Utc>,
    pub idpagamento: i64,
}

#[derive(Debug, Serialize)]
pub struct PagamentoResumoPublico {
    pub tipo: clarituz_domain::enums::TipoPagamento,
    pub status: clarituz_domain::enums::StatusPagamento,
    pub valor_centavos: i64,
    pub metodo: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct StatusPublicoOutput {
    pub status_reserva: clarituz_domain::enums::StatusReserva,
    /// True quando ao menos um pagamento está confirmado — leitura apenas;
    /// a confirmação de fato depende do webhook.
    pub confirmada: bool,
    pub pagamentos: Vec<PagamentoResumoPublico>,
}

#[derive(Debug, Deserialize)]
pub struct ReembolsarPagamentoInput {
    /// Centavos — igual ao pago = reembolso integral.
    pub valor_centavos: i64,
    pub motivo: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ReembolsoOutput {
    pub id: i64,
    pub refund_id: Option<String>,
    pub status: String,
}
