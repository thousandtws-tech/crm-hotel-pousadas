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

#[derive(Debug, Clone)]
pub struct NovoPedidoItem {
    pub iditem: i64,
    pub quantidade: i32,
    pub valor_unit: Decimal,
}

#[derive(Debug, Clone)]
pub struct NovoPedido {
    pub idfornecedor: i64,
    pub data_prevista: NaiveDate,
    pub valor_total: Decimal,
    pub origem: String,
    pub observacao: Option<String>,
    pub gerar_pagamento: bool,
    pub vencimento: NaiveDate,
}

#[derive(Debug, Clone)]
pub struct RecebimentoItem {
    pub iditem: i64,
    pub quantidade: i32,
}

#[async_trait]
pub trait ComprasRepository: Send + Sync {
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

    async fn listar_pedidos(
        &self,
        status: Option<&str>,
        page: PageParams,
    ) -> Result<Page<PedidoCompraView>, DomainError>;
    async fn buscar_pedido(
        &self,
        id: i64,
    ) -> Result<Option<(PedidoCompraView, Vec<PedidoItemView>)>, DomainError>;
    async fn criar_pedido(
        &self,
        pedido: &NovoPedido,
        itens: &[NovoPedidoItem],
        fornecedor: &Fornecedor,
        idfuncionario: i64,
        log: NovoLog,
    ) -> Result<(PedidoCompra, Vec<PedidoCompraItem>), DomainError>;
    async fn receber_pedido(
        &self,
        idpedido: i64,
        itens: &[RecebimentoItem],
        idfuncionario: i64,
        log: NovoLog,
    ) -> Result<PedidoCompra, DomainError>;
    async fn cancelar_pedido(&self, id: i64, log: NovoLog) -> Result<(), DomainError>;
}
