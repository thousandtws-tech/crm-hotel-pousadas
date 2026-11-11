use chrono::NaiveDate;
use clarituz_shared::PageParams;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct RegistrarPresencaInput {
    pub idreserva: i64,
    /// Opcional — padrão hoje (retroativo dentro da estadia).
    pub data: Option<NaiveDate>,
    pub quantidade: i32,
}

#[derive(Debug, Deserialize)]
pub struct QuadroCafeQuery {
    /// Dia do quadro — padrão hoje.
    pub data: Option<NaiveDate>,
}

#[derive(Debug, Deserialize)]
pub struct HistoricoCafeQuery {
    pub inicio: Option<NaiveDate>,
    pub fim: Option<NaiveDate>,
    #[serde(flatten)]
    pub page: PageParams,
}
