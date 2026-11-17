use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::Serialize;
use sqlx::FromRow;

/// Resumo financeiro de um período (equivalente a `financeiro/include/valores.php`).
#[derive(Debug, Clone, Serialize)]
pub struct ResumoFinanceiro {
    /// Fechado (consumos concluídos) no período.
    pub recebido: Decimal,
    pub recebido_estadias: Decimal,
    pub recebido_itens: Decimal,
    pub recebido_adicionais: Decimal,
    /// Cobranças online confirmadas (pagamento pago) no período — dinheiro
    /// antecipado que ainda não virou fatura de check-out. Não soma em
    /// `recebido`: a receita é reconhecida quando a estadia é faturada.
    pub recebido_online: Decimal,
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
