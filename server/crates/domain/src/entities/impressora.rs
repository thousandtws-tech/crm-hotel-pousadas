//! Impressoras térmicas de rede por setor (roteamento KOT).

use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::FromRow;

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct Impressora {
    pub id: i64,
    /// Nome amigável — ex.: "Cozinha", "Churrasqueira", "Balcão".
    pub nome: String,
    /// Setor de produção — ex.: "cozinha", "bar", "caixa".
    pub setor: String,
    pub ip: String,
    pub porta: i32,
    pub ativa: bool,
    /// Impressora padrão de comprovantes/recibos (no máximo uma).
    pub padrao: bool,
    /// Impressora dedicada a etiquetas de produto (no máximo uma).
    pub etiqueta: bool,
    pub version: i64,
    pub criado_em: DateTime<Utc>,
}

/// Impressora reportada pelo agente de descoberta (rede LAN ou USB do
/// host onde o agente roda) aguardando confirmação do administrador.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct ImpressoraDescoberta {
    pub id: i64,
    /// "rede" (TCP 9100/631/515) ou "usb" (fila instalada no SO do agente).
    pub tipo: String,
    /// IP (rede) ou nome da fila local (usb).
    pub endereco: String,
    pub porta: Option<i32>,
    /// Fabricante/modelo quando identificável (banner HTTP/IPP ou nome da fila).
    pub modelo: Option<String>,
    /// Host do agente que reportou a descoberta.
    pub origem: String,
    /// pendente → registrada | ignorada.
    pub status: String,
    pub impressora_id: Option<i64>,
    pub visto_em: DateTime<Utc>,
}

/// Job de impressão na fila do agente — payload já é ESC/POS renderizado
/// (serializa como array de bytes no JSON).
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct ImpressaoJob {
    pub id: i64,
    pub impressora_id: Option<i64>,
    pub host: String,
    pub porta: i32,
    pub payload: Vec<u8>,
    /// 'escpos' — байты RAW; 'texto' — рендер через драйвер ОС (этикетки).
    pub modo: String,
    pub status: String,
    pub tentativas: i32,
    pub erro: Option<String>,
    pub criado_em: DateTime<Utc>,
}
