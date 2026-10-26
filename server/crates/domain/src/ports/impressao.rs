//! Port de impressão — comprovantes em impressoras térmicas.
//!
//! O domínio descreve o recibo como uma sequência de [`LinhaRecibo`];
//! o adapter da infraestrutura converte para ESC/POS e envia.

use crate::entities::{Impressora, NovoLog};
use crate::error::DomainError;
use async_trait::async_trait;

/// Elemento de layout do cupom (80 mm ≈ 42 colunas na fonte A).
#[derive(Debug, Clone)]
pub enum LinhaRecibo {
    /// Texto alinhado à esquerda.
    Texto(String),
    /// Texto centralizado.
    Centro(String),
    /// Texto centralizado em negrito (cabeçalho/destaque).
    Titulo(String),
    /// Linha esquerda + valor alinhado à direita na mesma linha.
    Par { texto: String, valor: String },
    /// Separador horizontal.
    Separador,
    /// Avança `n` linhas em branco.
    Avanco(u8),
}

#[async_trait]
pub trait ImpressoraGateway: Send + Sync {
    /// Envia o recibo já formatado para a impressora em `host:porta`
    /// (RAW TCP — padrão JetDirect port 9100).
    async fn imprimir(
        &self,
        host: &str,
        porta: u16,
        linhas: &[LinhaRecibo],
    ) -> Result<(), DomainError>;
}

/// Dados de cadastro/edição de uma impressora de setor.
#[derive(Debug, Clone)]
pub struct DadosImpressora {
    pub nome: String,
    pub setor: String,
    pub ip: String,
    pub porta: i32,
    pub ativa: bool,
    pub padrao: bool,
    /// Concorrência otimista — usada só no update.
    pub version: Option<i64>,
}

/// Item de consumo resolvido com a impressora do seu setor
/// (item → estoque → categoria → impressora). `impressora` é `None`
/// quando a categoria não tem destino — o item não gera ticket.
#[derive(Debug, Clone)]
pub struct ItemProducao {
    pub nome: String,
    pub quantidade: i32,
    pub impressora: Option<Impressora>,
}

#[async_trait]
pub trait ImpressoraRepository: Send + Sync {
    async fn listar(&self) -> Result<Vec<Impressora>, DomainError>;
    async fn por_id(&self, id: i64) -> Result<Option<Impressora>, DomainError>;
    /// Impressora padrão (comprovantes) — a única com `padrao = true`.
    async fn padrao(&self) -> Result<Option<Impressora>, DomainError>;
    async fn criar(&self, dados: &DadosImpressora, log: NovoLog)
        -> Result<Impressora, DomainError>;
    async fn atualizar(
        &self,
        id: i64,
        dados: &DadosImpressora,
        log: NovoLog,
    ) -> Result<Impressora, DomainError>;
    async fn definir_ativa(&self, id: i64, ativa: bool, log: NovoLog) -> Result<(), DomainError>;
    async fn remover(&self, id: i64, log: NovoLog) -> Result<(), DomainError>;
    /// Itens de um consumo resolvidos com a impressora de destino,
    /// para montar os tickets de produção agrupados por setor.
    async fn itens_producao(&self, idconsumo: i64) -> Result<Vec<ItemProducao>, DomainError>;
    /// Impressora de destino de um item de estoque (via categoria).
    async fn por_item_estoque(&self, iditem: i64) -> Result<Option<Impressora>, DomainError>;
}
