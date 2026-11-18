//! Segmentação SMS — GSM-7 × UCS-2, conforme o contrato do provedor.
//!
//! Regras usuais documentadas: mensagem simples = 160 unidades GSM-7 ou
//! 70 UCS-2; concatenada = 153/67 por parte (UDH consome 6/3). Caracteres
//! da tabela de extensão GSM-7 contam como 2 unidades (ESC + char).
//! Emojis/acentos fora do alfabeto GSM-7 rebaixam a mensagem inteira pra
//! UCS-2 — a estimativa é feita sobre o texto FINAL (pós-variáveis).

/// Alfabeto GSM-7 básico — cada entrada custa 1 unidade.
const GSM7_BASICO: &str = concat!(
    "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\u{1B}ÆæßÉ ",
    "!\"#¤%&'()*+,-./0123456789:;<=>?¡",
    "ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿",
    "abcdefghijklmnopqrstuvwxyzäöñüà",
);

/// Tabela de extensão — cada caractere custa 2 unidades (ESC + char).
const GSM7_EXTENSAO: &str = "^{}\\[~]|€\u{0C}";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CodificacaoSms {
    Gsm7,
    Unicode,
}

impl CodificacaoSms {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Gsm7 => "gsm7",
            Self::Unicode => "unicode",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EstimativaSms {
    pub codificacao: CodificacaoSms,
    /// Unidades de dados que a mensagem ocupa (ext = 2, unicode = 1/char).
    pub unidades: usize,
    /// Partes SMS que o provedor cobra (1 = simples, >1 = concatenada).
    pub partes: usize,
}

fn unidades_gsm7(c: char) -> Option<usize> {
    if GSM7_BASICO.contains(c) {
        Some(1)
    } else if GSM7_EXTENSAO.contains(c) {
        Some(2)
    } else {
        None
    }
}

/// Estima encoding e segmentação do texto já renderizado — nunca
/// conta só caracteres visuais: em GSM-7 o que importa é unidades.
pub fn estimar(texto: &str) -> EstimativaSms {
    let mut gsm7_total: usize = 0;
    let mut unicode_total: usize = 0;
    let mut cabe_gsm7 = true;
    for c in texto.chars() {
        unicode_total += 1;
        match unidades_gsm7(c) {
            Some(n) => gsm7_total += n,
            None => cabe_gsm7 = false,
        }
    }
    if cabe_gsm7 {
        let cap = if gsm7_total <= 160 { 160 } else { 153 };
        let partes = gsm7_total.div_ceil(cap).max(1);
        return EstimativaSms {
            codificacao: CodificacaoSms::Gsm7,
            unidades: gsm7_total,
            partes,
        };
    }
    let cap = if unicode_total <= 70 { 70 } else { 67 };
    let partes = unicode_total.div_ceil(cap).max(1);
    EstimativaSms {
        codificacao: CodificacaoSms::Unicode,
        unidades: unicode_total,
        partes,
    }
}

#[cfg(test)]
mod tests {
    use super::{estimar, CodificacaoSms};

    #[test]
    fn texto_simples_gsm7_uma_parte() {
        let e = estimar("Espirito do Mar: sua reserva ABC123 esta confirmada.");
        assert_eq!(e.codificacao, CodificacaoSms::Gsm7);
        assert_eq!(e.partes, 1);
        assert_eq!(e.unidades, 52);
    }

    #[test]
    fn acentos_do_alfabeto_gsm7_nao_rebaixam() {
        // é à ç ñ estão no GSM-7; á í ó ã õ NÃO (realidade do alfabeto —
        // textos BR frequentes com ã vão pra UCS-2, é o preço real).
        let e = estimar("Reserva de Férias Café confirmada");
        assert_eq!(e.codificacao, CodificacaoSms::Gsm7);
        assert_eq!(e.partes, 1);
        let e = estimar("Confirmação recebida");
        assert_eq!(e.codificacao, CodificacaoSms::Unicode);
    }

    #[test]
    fn extensao_conta_dois() {
        // 158 básicos + "€" (2) = 160 → ainda 1 parte; +1 → 2 partes.
        let base = "a".repeat(158);
        assert_eq!(estimar(&format!("{base}€")).partes, 1);
        assert_eq!(estimar(&format!("{base}€a")).partes, 2);
    }

    #[test]
    fn unicode_emoji_uma_parte_ate_70() {
        let e = estimar("Olá! Sua reserva está confirmada 🌊");
        assert_eq!(e.codificacao, CodificacaoSms::Unicode);
        assert_eq!(e.partes, 1);
    }

    #[test]
    fn limites_concatenados() {
        // GSM-7: 160 simples; 161..306 = 2 partes (153/parte).
        assert_eq!(estimar(&"a".repeat(160)).partes, 1);
        assert_eq!(estimar(&"a".repeat(161)).partes, 2);
        assert_eq!(estimar(&"a".repeat(306)).partes, 2);
        assert_eq!(estimar(&"a".repeat(307)).partes, 3);
        // UCS-2: 70 simples; 71..134 = 2 partes (67/parte). 'ã' NÃO é
        // GSM-7 — é o caractere que força a rebaixar pra UCS-2.
        assert_eq!(estimar(&"ã".repeat(134)).partes, 2);
        assert_eq!(estimar(&"ã".repeat(135)).partes, 3);
    }
}
