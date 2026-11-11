use serde::{Deserialize, Serialize};

/// Origem da comanda — mesa do salão, quarto de hóspede ou balcão avulso.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "pdv_comanda_tipo", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum PdvComandaTipo {
    /// Mesa do salão — exige `idmesa`, uma comanda aberta por mesa.
    Mesa,
    /// Quarto de hóspede — exige `idquarto` (e reserva em estadia).
    Quarto,
    /// Venda avulsa de balcão — rótulo livre, sem mesa nem quarto.
    Balcao,
}

/// Estado da comanda.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "pdv_comanda_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum PdvComandaStatus {
    /// Em operação — admite itens e movimentos.
    Aberta,
    /// Encerrada — total e espelho financeiro já gerados.
    Fechada,
    /// Cancelada — itens estornados ao estoque.
    Cancelada,
}

/// Estado de um item lançado na comanda.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "pdv_item_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum PdvItemStatus {
    /// Lançado, na fila da cozinha.
    Pendente,
    /// Em preparo na cozinha.
    #[sqlx(rename = "em_preparo")]
    #[serde(rename = "em_preparo")]
    EmPreparo,
    /// Produzido — aguardando entrega pelo garçom/caixa.
    Pronto,
    /// Entregue ao cliente.
    Entregue,
    /// Cancelado — quantidade devolvida ao estoque.
    Cancelado,
}

/// Estado de pagamento da comissão do garçom.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "pdv_comissao_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum PdvComissaoStatus {
    /// Provisionada no fechamento, aguardando pagamento.
    Pendente,
    /// Paga — lançamento a pagar quitado.
    Paga,
}
