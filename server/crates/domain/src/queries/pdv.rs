use crate::enums::{PdvComandaStatus, PdvComandaTipo, PdvComissaoStatus, PdvItemStatus};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::Serialize;
use sqlx::FromRow;

/// Mesa com o estado da comanda aberta (se houver) — grade do salão.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct MesaView {
    pub id: i64,
    pub numero: String,
    pub lugares: i32,
    pub ativo: bool,
    /// Comanda aberta na mesa (None = mesa livre).
    pub idcomanda: Option<i64>,
    pub total_aberto: Option<Decimal>,
    pub garcom_nome: Option<String>,
}

/// Comanda enriquecida para listagens e painel de operação.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ComandaView {
    pub id: i64,
    pub tipo: PdvComandaTipo,
    pub idmesa: Option<i64>,
    pub mesa_numero: Option<String>,
    pub idquarto: Option<i64>,
    pub quarto_numero: Option<String>,
    pub idreserva: Option<i64>,
    pub idcliente: Option<i64>,
    pub cliente_nome: Option<String>,
    pub idgarcom: Option<i64>,
    pub garcom_nome: Option<String>,
    pub rotulo: Option<String>,
    pub status: PdvComandaStatus,
    /// Soma dos itens não cancelados (sempre recalculada na query).
    pub total_itens: Decimal,
    pub itens_pendentes: i64,
    pub desconto: Decimal,
    pub total: Decimal,
    pub idlancamento: Option<i64>,
    pub aberto_em: DateTime<Utc>,
    pub fechado_em: Option<DateTime<Utc>>,
    pub version: i64,
}

/// Item da comanda com nome/categoria do estoque.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ComandaItemView {
    pub id: i64,
    pub idcomanda: i64,
    pub iditem: i64,
    pub item_nome: String,
    pub categoria_nome: Option<String>,
    pub quantidade: i32,
    pub valor_unit: Decimal,
    pub valor_total: Decimal,
    pub status: PdvItemStatus,
    pub lancado_por: Option<i64>,
    pub lancado_por_nome: Option<String>,
    pub cancelado_por_nome: Option<String>,
    pub motivo_cancelamento: Option<String>,
    pub criado_em: DateTime<Utc>,
}

/// Item vendável no PDV — estoque ativo com quantidade disponível.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ItemVendaView {
    pub id: i64,
    pub nome: String,
    pub categoria_nome: Option<String>,
    pub quantidade: i32,
    pub valor_unitario: Decimal,
}

/// Garçom cadastrado com dados do funcionário.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct GarcomView {
    pub id: i64,
    pub idfuncionario: i64,
    pub funcionario_nome: String,
    pub percentual: Decimal,
    pub ativo: bool,
}

/// Comissão com contexto da comanda — extrato por garçom.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ComissaoView {
    pub id: i64,
    pub idgarcom: i64,
    pub garcom_nome: String,
    pub idcomanda: i64,
    pub comanda_descricao: String,
    pub percentual: Decimal,
    pub base: Decimal,
    pub valor: Decimal,
    pub status: PdvComissaoStatus,
    pub pago_em: Option<DateTime<Utc>>,
    pub criado_em: DateTime<Utc>,
}

/// Acumulado de comissões por garçom — pendente vs. pago.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ComissaoResumo {
    pub idgarcom: i64,
    pub garcom_nome: String,
    pub comissoes_pendentes: i64,
    pub valor_pendente: Decimal,
    pub valor_pago: Decimal,
}

/// Item na fila da cozinha (KDS) — comanda + contexto de destino.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct FilaItemView {
    pub id: i64,
    pub idcomanda: i64,
    pub comanda_tipo: PdvComandaTipo,
    pub mesa_numero: Option<String>,
    pub quarto_numero: Option<String>,
    pub rotulo: Option<String>,
    pub cliente_nome: Option<String>,
    pub garcom_nome: Option<String>,
    pub iditem: i64,
    pub item_nome: String,
    pub categoria_nome: Option<String>,
    pub quantidade: i32,
    pub status: PdvItemStatus,
    pub criado_em: DateTime<Utc>,
    pub comanda_aberto_em: DateTime<Utc>,
}
