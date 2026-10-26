//! Read models — projeções de consulta (joins, agregações, relatórios).
//! Separação CQRS-lite: entidades escrevem, estas structs respondem leituras.

use crate::enums::{StatusConsumo, StatusReserva, TipoMovimento};
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::Serialize;
use sqlx::FromRow;

/// Resumo de reserva para listagens e calendário.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ReservaResumo {
    pub id: i64,
    pub idacomodacao: i64,
    pub acomodacao_nome: String,
    pub acomodacao_numero: i32,
    pub acomodacao_cor: String,
    pub idcliente: i64,
    pub cliente_nome: String,
    pub quantidade_hospedes: i32,
    pub entradaprevista: NaiveDate,
    pub saidaprevista: NaiveDate,
    pub status: StatusReserva,
    pub valordiaria: Decimal,
    pub valor_estadia: Option<Decimal>,
}

/// Detalhe completo da reserva (equivalente a `cDadosReserva.php`).
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ReservaDetalhe {
    pub id: i64,
    pub idacomodacao: i64,
    pub idcliente: i64,
    pub idquarto: Option<i64>,
    pub quarto_numero: Option<String>,
    pub quantidade_hospedes: i32,
    pub entradaprevista: NaiveDate,
    pub saidaprevista: NaiveDate,
    pub checkin_em: Option<DateTime<Utc>>,
    pub checkout_em: Option<DateTime<Utc>>,
    pub obs: Option<String>,
    pub status: StatusReserva,
    pub valordiaria: Decimal,
    pub criado_em: DateTime<Utc>,
    pub acomodacao_nome: String,
    pub acomodacao_numero: i32,
    pub acomodacao_valor: Decimal,
    pub cliente_nome: String,
    pub cliente_cpf: String,
    /// Preenchido por segunda consulta — não vem do join principal.
    #[sqlx(skip)]
    pub consumo: Option<ConsumoResumo>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ConsumoResumo {
    pub id: i64,
    pub status: StatusConsumo,
    pub valor_estadia: Decimal,
    pub valor_itens: Decimal,
    pub valor_adicional: Decimal,
    pub total_desconto: Decimal,
    pub valor_final: Option<Decimal>,
    pub idforma_pagamento: Option<i64>,
    pub forma_pagamento: Option<String>,
    pub comprovante: Option<String>,
    pub fechado_em: Option<DateTime<Utc>>,
}

/// Acomodação livre no período (equivalente a `api/disponibilidade.php`).
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct AcomodacaoDisponivel {
    pub id: i64,
    pub nome: String,
    pub numero: i32,
    pub valor: Decimal,
    pub capacidade: i32,
}

/// Item do frigobar enriquecido com dados do estoque.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ItemFrigobarView {
    pub id: i64,
    pub idfrigobar: i64,
    pub iditem: i64,
    pub item_nome: String,
    pub valor_unitario: Decimal,
    pub quantidade: i32,
    pub ativo: bool,
}

/// Movimento de estoque enriquecido.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct MovimentoView {
    pub id: i64,
    pub iditem: i64,
    pub item_nome: String,
    pub tipo: TipoMovimento,
    pub quantidade: i32,
    pub funcionario: Option<String>,
    pub motivo: String,
    pub criado_em: DateTime<Utc>,
}

/// Cards do dashboard (equivalente a `home/include/dadosCard.php`).
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct DashboardCards {
    pub total_acomodacoes: i64,
    pub acomodacoes_disponiveis: i64,
    pub acomodacoes_ocupadas: i64,
    pub hospedes_atuais: i64,
    pub checkins_hoje: i64,
    pub checkouts_hoje: i64,
    pub checkins_pendentes_hoje: i64,
    pub checkouts_pendentes_hoje: i64,
}

/// Resumo financeiro de um período (equivalente a `financeiro/include/valores.php`).
#[derive(Debug, Clone, Serialize)]
pub struct ResumoFinanceiro {
    /// Fechado (consumos concluídos) no período.
    pub recebido: Decimal,
    pub recebido_estadias: Decimal,
    pub recebido_itens: Decimal,
    pub recebido_adicionais: Decimal,
    /// A receber: reservas não canceladas/finalizadas com saída no período.
    pub previsto: Decimal,
    pub descontos: Decimal,
    pub qtd_contas_fechadas: i64,
}

/// Ponto de série temporal para gráficos.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct PontoSerie {
    pub rotulo: String,
    pub valor: Decimal,
    pub quantidade: i64,
}

/// Ranking de item vendido no período (gráfico "Itens mais vendidos").
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ItemMaisVendido {
    pub nome: String,
    pub quantidade: i64,
    pub valor: Decimal,
}

/// Linha da tabela "Vendas" do financeiro (equivalente a `cFinanceiroVendas`).
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct VendaItem {
    pub idreserva: i64,
    pub item: String,
    pub quantidade: i32,
    pub valor_total: Decimal,
    pub criado_em: DateTime<Utc>,
}

/// Linha da tabela "Comprovantes de pagamento" do legado.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ComprovanteResumo {
    pub comprovante: String,
    pub idreserva: i64,
    pub cliente: String,
    pub acomodacao: String,
}

/// Check-in/check-out pendente de hoje (home).
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct PendenciaDia {
    pub idreserva: i64,
    pub acomodacao_nome: String,
    pub cliente_nome: String,
    pub entradaprevista: NaiveDate,
    pub saidaprevista: NaiveDate,
}
