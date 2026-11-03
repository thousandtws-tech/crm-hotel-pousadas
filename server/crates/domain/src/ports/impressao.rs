//! Port de impressão — comprovantes em impressoras térmicas.
//!
//! O domínio descreve o recibo como uma sequência de [`LinhaRecibo`];
//! o adapter da infraestrutura converte para ESC/POS e envia.

use crate::entities::{ImpressaoJob, Impressora, ImpressoraDescoberta, NovoLog};
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

    /// Etiqueta de produto — texto puro entregue pelo agente via driver do
    /// SO (funciona em qualquer modelo: Brother, Zebra, laser...).
    async fn etiqueta(&self, host: &str, porta: u16, texto: &str) -> Result<(), DomainError>;
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
    /// Impressora dedicada a etiquetas de produto.
    pub etiqueta: bool,
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

/// Dispositivo de impressão reportado pelo agente local.
#[derive(Debug, Clone)]
pub struct NovaDescoberta {
    /// "rede" ou "usb".
    pub tipo: String,
    pub endereco: String,
    pub porta: Option<i32>,
    pub modelo: Option<String>,
    pub origem: String,
}

#[async_trait]
pub trait ImpressoraRepository: Send + Sync {
    /// Upsert em lote das descobertas de um agente — re-reportar o mesmo
    /// dispositivo só atualiza `visto_em`/`modelo` (anti-duplicação).
    async fn registrar_descobertas(&self, itens: &[NovaDescoberta]) -> Result<usize, DomainError>;
    async fn listar_descobertas(&self) -> Result<Vec<ImpressoraDescoberta>, DomainError>;
    /// Promove a descoberta a impressora registrada (cria linha em
    /// `impressora` na mesma transação e vincula `impressora_id`).
    async fn registrar_impressora_da_descoberta(
        &self,
        descoberta_id: i64,
        dados: &DadosImpressora,
        log: NovoLog,
    ) -> Result<Impressora, DomainError>;
    async fn ignorar_descoberta(&self, id: i64) -> Result<(), DomainError>;
    /// Fila de impressão consumida pelo agente local.
    async fn jobs_pendentes(&self) -> Result<Vec<ImpressaoJob>, DomainError>;
    /// Resultado reportado pelo agente — falha retenta até 3 tentativas.
    async fn resultado_job(
        &self,
        id: i64,
        sucesso: bool,
        erro: Option<&str>,
    ) -> Result<(), DomainError>;

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
