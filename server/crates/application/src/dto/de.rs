use rust_decimal::Decimal;
use serde::{Deserialize, Deserializer};

/// Aceita `"123.45"`, `123.45` ou o formato brasileiro `"1.234,56"`.
fn parse_decimal(v: &serde_json::Value) -> Result<Decimal, String> {
    match v {
        serde_json::Value::String(s) => {
            let s = s.trim().replace("R$", "").trim().to_string();
            let canon = if s.contains(',') {
                // formato BR: ponto = milhar, vírgula = decimal
                s.replace('.', "").replace(',', ".")
            } else {
                s
            };
            canon
                .parse::<Decimal>()
                .map_err(|_| "valor monetário inválido".to_string())
        }
        serde_json::Value::Number(n) => n
            .to_string()
            .parse::<Decimal>()
            .map_err(|_| "valor monetário inválido".to_string()),
        _ => Err("valor monetário inválido".to_string()),
    }
}

pub fn de_decimal<'de, D: Deserializer<'de>>(d: D) -> Result<Decimal, D::Error> {
    let v = serde_json::Value::deserialize(d)?;
    parse_decimal(&v).map_err(serde::de::Error::custom)
}

pub fn de_decimal_opt<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Decimal>, D::Error> {
    let v = Option::<serde_json::Value>::deserialize(d)?;
    match v {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(v) => parse_decimal(&v)
            .map(Some)
            .map_err(serde::de::Error::custom),
    }
}

/// `Option<i64>` tolerante a string — necessário em structs achatadas via
/// `#[serde(flatten)]` dentro de query strings (`serde_urlencoded` entrega
/// `Content::String` aos campos internos do flatten).
pub fn de_i64_opt<'de, D: Deserializer<'de>>(d: D) -> Result<Option<i64>, D::Error> {
    let v = Option::<serde_json::Value>::deserialize(d)?;
    match v {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(serde_json::Value::Number(n)) => n
            .as_i64()
            .map(Some)
            .ok_or_else(|| serde::de::Error::custom("inteiro inválido")),
        Some(serde_json::Value::String(s)) if s.trim().is_empty() => Ok(None),
        Some(serde_json::Value::String(s)) => s
            .trim()
            .parse::<i64>()
            .map(Some)
            .map_err(|_| serde::de::Error::custom("inteiro inválido")),
        _ => Err(serde::de::Error::custom("inteiro inválido")),
    }
}
