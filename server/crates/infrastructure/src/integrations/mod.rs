//! Integrações externas — gateways de pagamento (Stripe), concierge de
//! IA (Maria) e emissores de envio (e-mail, WhatsApp, Web Push).

pub mod maria;
pub mod senders;
pub mod stripe;
