//! Normalização de telefone para WhatsApp — dígitos com DDI.
//!
//! Regra: só saem dígitos (Z-API espera `55DDDNUMERO`); entradas com
//! 10–11 dígitos são tratadas como Brasil e recebem o prefixo 55; com
//! DDI explícito (12–15 dígitos) vão como estão. Fora disso, `None` —
//! o chamador decide como tratar (supressão auditável, não envio cego).

/// Devolve os dígitos normalizados (com DDI) ou `None` quando o número
/// não é utilizável para envio de WhatsApp.
pub fn normalizar_whatsapp(telefone: &str) -> Option<String> {
    let digitos: String = telefone.chars().filter(char::is_ascii_digit).collect();
    match digitos.len() {
        // Brasil sem DDI: DDD + número (fixo 10, celular 11).
        10 | 11 => Some(format!("55{digitos}")),
        // Com DDI (55 + 10/11 = 12/13) ou internacional (até E.164: 15).
        12..=15 => Some(digitos),
        _ => None,
    }
}

/// Normalisera med explicit DDI från landkodsväljaren — undviker
/// tvetydigheten hos t.ex. svenska 10-siffriga nummer (som annars
/// skulle tolkas som brasilianska och få +55).
pub fn normalizar_whatsapp_ddi(telefone: &str, ddi: Option<&str>) -> Option<String> {
    let mut lokala: String = telefone.chars().filter(char::is_ascii_digit).collect();
    let dd: String = ddi
        .unwrap_or_default()
        .chars()
        .filter(char::is_ascii_digit)
        .collect();
    if dd.is_empty() {
        return normalizar_whatsapp(telefone);
    }
    // Nummret kan redan innehålla samma DDI — dubblera inte.
    if lokala.starts_with(&dd) && lokala.len() > dd.len() + 5 {
        return Some(lokala);
    }
    while lokala.starts_with('0') {
        lokala.remove(0);
    }
    let full = format!("{dd}{lokala}");
    ((8..=15).contains(&full.len()) && !lokala.is_empty()).then_some(full)
}

#[cfg(test)]
mod tests {
    use super::{normalizar_whatsapp, normalizar_whatsapp_ddi};

    #[test]
    fn celular_br_sem_ddi_ganha_55() {
        assert_eq!(
            normalizar_whatsapp("(85) 99999-1234").as_deref(),
            Some("5585999991234")
        );
    }

    #[test]
    fn fixo_br_sem_ddi_ganha_55() {
        assert_eq!(
            normalizar_whatsapp("85 3222-4455").as_deref(),
            Some("558532224455")
        );
    }

    #[test]
    fn ja_com_ddi_55_permance() {
        assert_eq!(
            normalizar_whatsapp("+55 85 99999-1234").as_deref(),
            Some("5585999991234")
        );
    }

    /// 10–11 dígitos sem hint são Brasil por convenção — o DDI explícito
    /// (`telefone_ddi` do formulário) é o que desambigua internacionais.
    #[test]
    fn internacional_precisa_do_ddi_explicito() {
        // Sem hint: 11 dígitos caem na regra brasileira (comportamento legado).
        assert_eq!(
            normalizar_whatsapp("+1 305 555 0134").as_deref(),
            Some("5513055550134")
        );
        // Com hint do seletor de país, o número é respeitado como está.
        assert_eq!(
            normalizar_whatsapp_ddi("+1 305 555 0134", Some("1")).as_deref(),
            Some("13055550134")
        );
        // Sueco com zero à esquerda: remove o tronco nacional.
        assert_eq!(
            normalizar_whatsapp_ddi("070-123 45 67", Some("46")).as_deref(),
            Some("46701234567")
        );
        // BR com hint: normaliza igual (DDD + número).
        assert_eq!(
            normalizar_whatsapp_ddi("(85) 99999-1234", Some("55")).as_deref(),
            Some("5585999991234")
        );
    }

    #[test]
    fn curto_demais_e_longo_demais_sao_invalidos() {
        assert_eq!(normalizar_whatsapp("99999"), None);
        assert_eq!(normalizar_whatsapp(""), None);
        assert_eq!(normalizar_whatsapp("+55 85 999"), None);
        assert_eq!(normalizar_whatsapp("123456789012345678"), None);
    }
}
