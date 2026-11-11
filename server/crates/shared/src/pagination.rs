//! Paginação limit/offset com limites rígidos — nunca permitir varreduras ilimitadas.

use serde::{Deserialize, Serialize};

/// Parâmetros de paginação aceitos via query string.
/// `deserialize_with` aceita string e número — `serde_urlencoded` entrega
/// tudo como string quando a struct é `#[serde(flatten)]`ada.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct PageParams {
    #[serde(
        default = "default_page",
        alias = "pagina",
        deserialize_with = "de_u32"
    )]
    pub page: u32,
    #[serde(
        default = "default_per_page",
        alias = "por_pagina",
        deserialize_with = "de_u32"
    )]
    pub per_page: u32,
}

fn de_u32<'de, D>(d: D) -> Result<u32, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de::Error;
    match serde_json::Value::deserialize(d)? {
        serde_json::Value::Number(n) => n
            .as_u64()
            .and_then(|v| u32::try_from(v).ok())
            .ok_or_else(|| Error::custom("parâmetro de paginação inválido")),
        serde_json::Value::String(s) => s
            .trim()
            .parse::<u32>()
            .map_err(|_| Error::custom("parâmetro de paginação inválido")),
        _ => Err(Error::custom("parâmetro de paginação inválido")),
    }
}

const fn default_page() -> u32 {
    1
}
const fn default_per_page() -> u32 {
    20
}

pub const MAX_PER_PAGE: u32 = 200;

impl Default for PageParams {
    fn default() -> Self {
        Self {
            page: 1,
            per_page: default_per_page(),
        }
    }
}

impl PageParams {
    #[must_use]
    pub fn sanitized(self) -> Self {
        Self {
            page: self.page.max(1),
            per_page: self.per_page.clamp(1, MAX_PER_PAGE),
        }
    }

    pub fn limit(self) -> i64 {
        i64::from(self.sanitized().per_page)
    }

    pub fn offset(self) -> i64 {
        let p = self.sanitized();
        i64::from(p.page - 1) * i64::from(p.per_page)
    }
}

/// Envelope de resposta paginada.
#[derive(Debug, Clone, Serialize)]
pub struct Page<T> {
    pub items: Vec<T>,
    pub page: u32,
    pub per_page: u32,
    pub total: i64,
}

impl<T> Page<T> {
    pub fn new(items: Vec<T>, params: PageParams, total: i64) -> Self {
        let p = params.sanitized();
        Self {
            items,
            page: p.page,
            per_page: p.per_page,
            total,
        }
    }

    pub fn map<U, F: FnMut(T) -> U>(self, f: F) -> Page<U> {
        Page {
            items: self.items.into_iter().map(f).collect(),
            page: self.page,
            per_page: self.per_page,
            total: self.total,
        }
    }
}
