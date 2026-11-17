//! Integrações externas — gateways de pagamento (Stripe, PagBank,
//! Mercado Pago), concierge de IA (Maria) e emissores de envio
//! (e-mail, WhatsApp, Web Push).

pub mod maria;
pub mod mercadopago;
pub mod pagbank;
pub mod resolver;
pub mod resolver_whatsapp;
pub mod senders;
pub mod spedy;
pub mod stripe;
pub mod zapi;
