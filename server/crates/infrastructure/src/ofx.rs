use chrono::NaiveDate;
use clarituz_domain::DomainError;
use rust_decimal::Decimal;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::str::FromStr;

#[derive(Debug, Clone, PartialEq)]
pub struct TransacaoExtrato {
    pub data: NaiveDate,
    pub descricao: String,
    pub documento: Option<String>,
    pub valor: Decimal,
    pub fit_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Formato {
    Ofx,
    Csv,
}

pub fn parse_extrato(conteudo: &str) -> Result<Vec<TransacaoExtrato>, DomainError> {
    let cabeca = &conteudo[..conteudo.len().min(4096)];
    let formato = if cabeca.contains("OFXHEADER") || cabeca.contains("<OFX>") {
        Formato::Ofx
    } else {
        Formato::Csv
    };
    match formato {
        Formato::Ofx => parse_ofx(conteudo),
        Formato::Csv => parse_csv(conteudo),
    }
}

fn tag<'a>(bloco: &'a str, nome: &str) -> Option<&'a str> {
    let abre = format!("<{nome}>");
    let ini = bloco.find(&abre)? + abre.len();
    let resto = &bloco[ini..];
    let fim = resto
        .find('<')
        .or_else(|| resto.find('\n'))
        .unwrap_or(resto.len());
    let v = resto[..fim].trim();
    (!v.is_empty()).then_some(v)
}

fn parse_data_ofx(raw: &str) -> Option<NaiveDate> {
    let d = raw.trim();
    if d.len() < 8 {
        return None;
    }
    NaiveDate::parse_from_str(&d[..8], "%Y%m%d").ok()
}

fn hash_fit(partes: &[&str]) -> String {
    let mut h = Sha256::new();
    for p in partes {
        h.update(p.as_bytes());
        h.update(b"|");
    }
    hex::encode(h.finalize())[..32].to_string()
}

fn parse_ofx(conteudo: &str) -> Result<Vec<TransacaoExtrato>, DomainError> {
    let mut itens = Vec::new();
    let mut resto = conteudo;

    while let Some(ini) = resto.find("<STMTTRN>") {
        let bloco = match resto[ini..].find("</STMTTRN>") {
            Some(f) => &resto[ini..ini + f],
            None => &resto[ini..],
        };
        resto = &resto[ini + bloco.len().max(9)..];

        let Some(data) = tag(bloco, "DTPOSTED").and_then(parse_data_ofx) else {
            continue;
        };
        let Some(valor) = tag(bloco, "TRNAMT").and_then(|v| Decimal::from_str(v).ok()) else {
            continue;
        };
        let descricao = tag(bloco, "MEMO")
            .or_else(|| tag(bloco, "NAME"))
            .unwrap_or("Sem descrição")
            .to_string();
        let documento = tag(bloco, "CHECKNUM")
            .or_else(|| tag(bloco, "REFNUM"))
            .map(str::to_string);
        let fit_id = tag(bloco, "FITID").map_or_else(
            || hash_fit(&[&data.to_string(), &descricao, &valor.to_string()]),
            str::to_string,
        );

        itens.push(TransacaoExtrato {
            data,
            descricao,
            documento,
            valor,
            fit_id,
        });
    }

    if itens.is_empty() {
        return Err(DomainError::validacao(
            "Nenhuma transação encontrada no arquivo OFX.",
        ));
    }
    Ok(itens)
}

fn parse_data_csv(raw: &str) -> Option<NaiveDate> {
    let d = raw.trim().trim_matches('"');
    for fmt in ["%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d"] {
        if let Ok(dt) = NaiveDate::parse_from_str(d, fmt) {
            return Some(dt);
        }
    }
    None
}

fn parse_valor_csv(raw: &str) -> Option<Decimal> {
    let s = raw
        .trim()
        .trim_matches('"')
        .replace("R$", "")
        .replace('\u{00a0}', "")
        .trim()
        .to_string();
    if s.is_empty() {
        return None;
    }
    let canon = if s.contains(',') {
        s.replace('.', "").replace(',', ".")
    } else {
        s
    };
    Decimal::from_str(&canon).ok()
}

fn normalizar(txt: &str) -> String {
    txt.trim().trim_matches('"').to_lowercase()
}

fn parse_csv(conteudo: &str) -> Result<Vec<TransacaoExtrato>, DomainError> {
    let mut linhas = conteudo.lines().filter(|l| !l.trim().is_empty());
    let Some(primeira) = linhas.next() else {
        return Err(DomainError::validacao("Arquivo CSV vazio."));
    };

    let sep = [';', ',', '\t']
        .into_iter()
        .max_by_key(|s| primeira.matches(*s).count())
        .unwrap_or(';');

    let cells: Vec<String> = primeira.split(sep).map(normalizar).collect();
    #[allow(clippy::type_complexity)]
    let (mapa, resto): (
        Option<HashMap<String, usize>>,
        Box<dyn Iterator<Item = &str>>,
    ) = if parse_data_csv(&cells[0]).is_none() {
        let m = cells
            .iter()
            .enumerate()
            .map(|(i, c)| (c.clone(), i))
            .collect();
        (Some(m), Box::new(linhas))
    } else {
        (None, Box::new(std::iter::once(primeira).chain(linhas)))
    };

    let col = |m: &Option<HashMap<String, usize>>, nomes: &[&str], default: usize| -> usize {
        m.as_ref()
            .and_then(|mm| nomes.iter().find_map(|n| mm.get(*n).copied()))
            .unwrap_or(default)
    };
    let c_data = col(&mapa, &["data", "dt", "date"], 0);
    let c_desc = col(
        &mapa,
        &[
            "descricao",
            "descrição",
            "historico",
            "histórico",
            "memo",
            "lancamento",
            "lançamento",
        ],
        1,
    );
    let c_valor = col(&mapa, &["valor", "amount", "valor (r$)"], 2);
    let c_doc = mapa.as_ref().and_then(|mm| {
        [
            "documento",
            "doc",
            "numero",
            "número",
            "referencia",
            "referência",
        ]
        .iter()
        .find_map(|n| mm.get(*n).copied())
    });

    let mut itens = Vec::new();
    // dedup intra-arquivo preservando ocorrências legítimas repetidas
    let mut ocorrencias: HashMap<String, u32> = HashMap::new();

    for linha in resto {
        let cols: Vec<&str> = linha.split(sep).collect();
        if cols.len() <= c_valor.max(c_desc).max(c_data) {
            continue;
        }
        let Some(data) = parse_data_csv(cols[c_data]) else {
            continue;
        };
        let Some(valor) = parse_valor_csv(cols[c_valor]) else {
            continue;
        };
        let descricao = cols[c_desc].trim().trim_matches('"').to_string();
        if descricao.is_empty() {
            continue;
        }
        let documento = c_doc
            .and_then(|i| cols.get(i))
            .map(|d| d.trim().trim_matches('"').to_string())
            .filter(|d| !d.is_empty());

        let base = hash_fit(&[&data.to_string(), &descricao, &valor.to_string()]);
        let n = ocorrencias.entry(base.clone()).or_insert(0);
        *n += 1;
        let fit_id = if *n > 1 { format!("{base}#{n}") } else { base };

        itens.push(TransacaoExtrato {
            data,
            descricao,
            documento,
            valor,
            fit_id,
        });
    }

    if itens.is_empty() {
        return Err(DomainError::validacao(
            "Nenhuma transação encontrada no CSV — esperado data;descrição;valor.",
        ));
    }
    Ok(itens)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    const OFX_V1: &str = r"OFXHEADER:100
DATA:OFXSGML
VERSION:102
<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<CURDEF>BRL
<BANKACCTFROM>
<BANKID>077
<ACCTID>12345-6
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20260101000000
<DTEND>20260131235959
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260105120000[-3:BRT]
<TRNAMT>1500.00
<FITID>AAA001
<MEMO>PIX RECEBIDO RESERVA 102
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260107120000[-3:BRT]
<TRNAMT>-45.90
<FITID>BBB002
<MEMO>TARIFA PACOTE
</STMTTRN>
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>";

    #[test]
    fn ofx_v1_duas_transacoes() {
        let itens = parse_ofx(OFX_V1).unwrap();
        assert_eq!(itens.len(), 2);
        assert_eq!(itens[0].data, NaiveDate::from_ymd_opt(2026, 1, 5).unwrap());
        assert_eq!(itens[0].valor, dec!(1500.00));
        assert_eq!(itens[0].fit_id, "AAA001");
        assert_eq!(itens[0].descricao, "PIX RECEBIDO RESERVA 102");
        assert_eq!(itens[1].valor, dec!(-45.90));
    }

    #[test]
    fn csv_posicional_br() {
        let csv = "05/01/2026;PIX RECEBIDO;1.500,00\n07/01/2026;TARIFA;-45,90\n";
        let itens = parse_extrato(csv).unwrap();
        assert_eq!(itens.len(), 2);
        assert_eq!(itens[0].valor, dec!(1500.00));
        assert_eq!(itens[1].valor, dec!(-45.90));
        // fit_id sintético estável — reimportar deduplica no banco
        assert_eq!(itens[0].fit_id.len(), 32);
    }

    #[test]
    fn csv_com_cabecalho_e_saldo() {
        let csv = "Data;Histórico;Valor;Saldo\n2026-01-05;Pix;1500.00;9000.00\n";
        let itens = parse_extrato(csv).unwrap();
        assert_eq!(itens.len(), 1);
        assert_eq!(itens[0].valor, dec!(1500.00));
    }

    #[test]
    fn csv_duplicada_legitima() {
        let csv = "05/01/2026;PIX;100,00\n05/01/2026;PIX;100,00\n";
        let itens = parse_extrato(csv).unwrap();
        assert_eq!(itens.len(), 2);
        assert_ne!(itens[0].fit_id, itens[1].fit_id); // #2 no sufixo
    }

    #[test]
    fn vazio_erro() {
        assert!(parse_extrato("").is_err());
    }
}
