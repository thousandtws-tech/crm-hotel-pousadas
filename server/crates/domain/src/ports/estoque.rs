//! Ports do contexto de estoque.

use crate::entities::{
    CategoriaEstoque, ConversaoUnidade, FichaTecnica, ItemEstoque, NfeImport, NovoLog,
};
use crate::enums::TipoMovimento;
use crate::error::DomainError;
use crate::queries::{EstoqueBaixoView, FichaItemView, MovimentoView};
use async_trait::async_trait;
use chrono::NaiveDate;
use clarituz_shared::{Page, PageParams};
use rust_decimal::Decimal;

#[derive(Debug, Clone)]
pub struct NovoItem {
    pub nome: String,
    pub idcategoria: Option<i64>,
    pub quantidade_inicial: i32,
    pub valor_unitario: Decimal,
    pub unidade: Option<String>,
    pub estoque_minimo: Option<i32>,
    pub eh_insumo: bool,
}

#[derive(Debug, Clone, Default)]
pub struct AtualizaItem {
    pub nome: Option<String>,
    pub idcategoria: Option<i64>,
    pub valor_unitario: Option<Decimal>,
    pub unidade: Option<String>,
    pub estoque_minimo: Option<i32>,
    pub eh_insumo: Option<bool>,
    /// Concorrência otimista — divergência → 409.
    pub version: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct Movimentacao {
    pub iditem: i64,
    pub tipo: TipoMovimento,
    pub quantidade: i32,
    pub motivo: String,
}

#[async_trait]
pub trait EstoqueRepository: Send + Sync {
    // categorias
    async fn listar_categorias(
        &self,
        apenas_ativas: bool,
    ) -> Result<Vec<CategoriaEstoque>, DomainError>;
    async fn criar_categoria(
        &self,
        nome: &str,
        log: NovoLog,
    ) -> Result<CategoriaEstoque, DomainError>;
    /// Roteamento KOT: vincula a categoria à impressora do setor
    /// (`None` remove o destino — itens deixam de imprimir ticket).
    async fn definir_impressora_categoria(
        &self,
        id: i64,
        impressora_id: Option<i64>,
        log: NovoLog,
    ) -> Result<CategoriaEstoque, DomainError>;
    async fn definir_categoria_ativa(
        &self,
        id: i64,
        ativo: bool,
        log: NovoLog,
    ) -> Result<CategoriaEstoque, DomainError>;
    /// Remove a categoria — falha (409) se houver itens vinculados.
    async fn remover_categoria(&self, id: i64, log: NovoLog) -> Result<(), DomainError>;

    // itens
    async fn buscar_item(&self, id: i64) -> Result<Option<ItemEstoque>, DomainError>;
    async fn listar_itens(
        &self,
        apenas_ativos: bool,
        page: PageParams,
    ) -> Result<Page<ItemEstoque>, DomainError>;
    async fn criar_item(
        &self,
        novo: &NovoItem,
        idfuncionario: i64,
        log: NovoLog,
    ) -> Result<ItemEstoque, DomainError>;
    async fn atualizar_item(
        &self,
        id: i64,
        dados: &AtualizaItem,
        log: NovoLog,
    ) -> Result<ItemEstoque, DomainError>;
    async fn definir_item_ativo(
        &self,
        id: i64,
        ativo: bool,
        log: NovoLog,
    ) -> Result<ItemEstoque, DomainError>;

    /// Remove o item junto com seus movimentos de estoque e vínculos em
    /// frigobares — falha (409) se já foi consumido em reservas.
    async fn remover_item(&self, id: i64, log: NovoLog) -> Result<(), DomainError>;

    /// Movimentações em lote, cada uma atômica: atualiza saldo (`CHECK >= 0`
    /// impede negativo) e grava o lançamento no ledger.
    async fn movimentar(
        &self,
        movimentos: &[Movimentacao],
        idfuncionario: i64,
        log: NovoLog,
    ) -> Result<u64, DomainError>;

    async fn listar_movimentos(
        &self,
        iditem: Option<i64>,
        page: PageParams,
    ) -> Result<Page<MovimentoView>, DomainError>;

    // -- ficha tecnica -------------------------------------------------------
    async fn listar_ficha(&self, idproduto: i64) -> Result<Vec<FichaItemView>, DomainError>;
    async fn salvar_ficha_item(
        &self,
        idproduto: i64,
        idinsumo: i64,
        quantidade: i32,
        log: NovoLog,
    ) -> Result<FichaTecnica, DomainError>;
    async fn remover_ficha_item(&self, idficha: i64, log: NovoLog) -> Result<(), DomainError>;

    // -- conversoes de unidade ----------------------------------------------
    async fn listar_conversoes(&self, iditem: i64) -> Result<Vec<ConversaoUnidade>, DomainError>;
    async fn salvar_conversao(
        &self,
        iditem: i64,
        unidade_compra: &str,
        fator: i32,
        log: NovoLog,
    ) -> Result<ConversaoUnidade, DomainError>;
    async fn remover_conversao(&self, id: i64, log: NovoLog) -> Result<(), DomainError>;

    // -- alertas -------------------------------------------------------------
    async fn alertas_minimo(&self) -> Result<Vec<EstoqueBaixoView>, DomainError>;

    // -- NF-e ------------------------------------------------------------------
    async fn nfe_ja_importada(&self, chave: &str) -> Result<bool, DomainError>;
    async fn registrar_nfe(
        &self,
        nfe: &NfeRegistro,
        itens: &[NfeItemConfirmado],
        idfuncionario: i64,
        log: NovoLog,
    ) -> Result<NfeImport, DomainError>;
}

/// Item confirmado de uma NF-e ja mapeado para o estoque.
#[derive(Debug, Clone)]
pub struct NfeItemConfirmado {
    /// `Some` quando mapeado para item existente; `None` cria um novo.
    pub iditem: Option<i64>,
    pub nome: String,
    /// Unidade da NF (ex.: "CX", "KG").
    pub unidade_compra: String,
    /// Fator de conversao -> unidade base (1 unidade_compra = fator base).
    pub fator: i32,
    /// Quantidade na unidade da nota.
    pub quantidade: Decimal,
    /// Valor total da linha na nota.
    pub valor_total: Decimal,
    /// Quantidade ja convertida para a unidade base.
    pub quantidade_base: i32,
}

/// Cabecalho da NF-e confirmada para registro.
#[derive(Debug, Clone)]
pub struct NfeRegistro {
    pub chave: String,
    pub numero: Option<String>,
    pub emitente: Option<String>,
    pub cnpj: Option<String>,
    pub emissao: Option<NaiveDate>,
    pub total: Decimal,
    pub vencimento: NaiveDate,
    /// Se falso, nao gera lancamento a pagar.
    pub gerar_pagamento: bool,
}
