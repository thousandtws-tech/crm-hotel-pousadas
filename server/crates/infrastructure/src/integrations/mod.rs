//! Integrações externas — gateways de pagamento (Stripe, PagBank,
//! Mercado Pago), concierge de IA (Maria) e emissores de envio
//! (e-mail, WhatsApp, Web Push).

pub mod channex;
pub mod didit;
pub mod maria;
pub mod mercadopago;
pub mod pagbank;
pub mod resolver;
pub mod resolver_whatsapp;
pub mod senders;
pub mod spedy;
pub mod stripe;
pub mod zapi;

/// Documento do pagador apto a ir ao provedor: CPF real (dígitos
/// verificadores) ou CNPJ por tamanho. O fluxo público grava
/// `SITE-{fone}-{hash}` na coluna cpf quando o hóspede não informa
/// documento — repassar essa cadeia como CPF quebra a validação do
/// provedor (PagBank rejeita o checkout) e derruba o score antifraude
/// do MP. Retorna o tipo a declarar (`"CPF"`/`"CNPJ"`) ou `None`.
pub(crate) fn tipo_documento_pagador(digitos: &str) -> Option<&'static str> {
    if digitos.len() == 14 {
        return Some("CNPJ");
    }
    if digitos.len() != 11 || digitos.chars().all(|c| c == digitos.as_bytes()[0] as char) {
        return None;
    }
    let n: Vec<u32> = digitos.chars().filter_map(|c| c.to_digit(10)).collect();
    if n.len() != 11 {
        return None;
    }
    let dv = |ate: usize| {
        let s: u32 = (0..ate).map(|i| n[i] * (ate as u32 + 1 - i as u32)).sum();
        let r = s % 11;
        if r < 2 {
            0
        } else {
            11 - r
        }
    };
    if dv(9) == n[9] && dv(10) == n[10] {
        Some("CPF")
    } else {
        None
    }
}
