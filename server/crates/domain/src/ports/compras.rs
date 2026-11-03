//! Ports do contexto de compras (fornecedores + pedidos).

use crate::entities::{Fornecedor, NovoLog, PedidoCompra, PedidoCompraItem};
use crate::error::DomainError;
use crate::queries::{PedidoCompraView, PedidoItemView};
use async_trait::async_trait;
use chrono::NaiveDate;
use clarituz_shared::{Page, PageParams};
use rust_decimal::Decimal;

#[derive(Debug, Clone, Default)]
pub struct NovoFornecedor {
    pub nome: String,
    pub cnpj: Option<String>,
    pub contato: Option<String>,
    pub telefone: Option<String>,
    pub lead_time_dias: i32,
}

/// Item de um novo pedido de compra.
#[derive(Debug, Clone)]
pub struct NovoPedidoItem {
    pub iditem: i64,
    pub quantidade: i32,
    pub valor_unit: Decimal,
}

/// Cabeçalho de um novo pedido — data_prevista já calculada (hoje + lead time).
#[derive(Debug, Clone)]
pub struct NovoPedido {
    pub idfornecedor: i64,
    pub data_prevista: NaiveDate,
    pub valor_total: Decimal,
    pub origem: String,
    pub observacao: Option<String>,
    /// Quando `Some`, gera a conta a pagar na mesma transação.
    pub gerar_pagamento: bool,
    pub vencimento: NaiveDate,
}

/// Linha de recebimento parcial/total.
#[derive(Debug, Clone)]
pub struct RecebimentoItem {
    pub iditem: i64,
    pub quantidade: i32,
}

#[async_trait]
pub trait ComprasRepository: Send + Sync {
    // fornecedores
    async fn listar_fornecedores(
        &self,
        apenas_ativos: bool,
    ) -> Result<Vec<Fornecedor>, DomainError>;
    async fn buscar_fornecedor(&self, id: i64) -> Result<Option<Fornecedor>, DomainError>;
    async fn salvar_fornecedor(
        &self,
        novo: &NovoFornecedor,
        log: NovoLog,
    ) -> Result<Fornecedor, DomainError>;
    async fn definir_fornecedor_ativo(
        &self,
        id: i64,
        ativo: bool,
        log: NovoLog,
    ) -> Result<Fornecedor, DomainError>;

    // pedidos
    async fn listar_pedidos(
        &self,
        status: Option<&str>,
        page: PageParams,
    ) -> Result<Page<PedidoCompraView>, DomainError>;
    async fn buscar_pedido(
        &self,
        id: i64,
    ) -> Result<Option<(PedidoCompraView, Vec<PedidoItemView>)>, DomainError>;
    /// Tx única: pedido + itens + conta a pagar vinculada ao fornecedor.
    async fn criar_pedido(
        &self,
        pedido: &NovoPedido,
        itens: &[NovoPedidoItem],
        fornecedor: &Fornecedor,
        idfuncionario: i64,
        log: NovoLog,
    ) -> Result<(PedidoCompra, Vec<PedidoCompraItem>), DomainError>;
    /// Recebimento parcial/total: FOR UPDATE nos itens, valida anti-duplicação
    /// (recebido + entrada <= pedido), dá entrada no estoque com movimentos,
    /// atualiza quantidade_recebida e recalcula o status do pedido.
    async fn receber_pedido(
        &self,
        idpedido: i64,
        itens: &[RecebimentoItem],
        idfuncionario: i64,
        log: NovoLog,
    ) -> Result<PedidoCompra, DomainError>;
    async fn cancelar_pedido(&self, id: i64, log: NovoLog) -> Result<(), DomainError>;
}
