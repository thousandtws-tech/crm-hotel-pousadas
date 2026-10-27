//! Ports do contexto de estoque.

use crate::entities::{CategoriaEstoque, ItemEstoque, NovoLog};
use crate::enums::TipoMovimento;
use crate::error::DomainError;
use crate::queries::MovimentoView;
use async_trait::async_trait;
use clarituz_shared::{Page, PageParams};
use rust_decimal::Decimal;

#[derive(Debug, Clone)]
pub struct NovoItem {
    pub nome: String,
    pub idcategoria: Option<i64>,
    pub quantidade_inicial: i32,
    pub valor_unitario: Decimal,
}

#[derive(Debug, Clone, Default)]
pub struct AtualizaItem {
    pub nome: Option<String>,
    pub idcategoria: Option<i64>,
    pub valor_unitario: Option<Decimal>,
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
}
