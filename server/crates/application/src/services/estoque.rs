//! Casos de uso de estoque: categorias, itens e movimentações em lote.

use crate::actor::Ator;
use crate::dto::{ItemEstoqueInput, ItemEstoqueUpdate, MovimentacoesRequest, NomeInput};
use crate::error::AppResult;
use clarituz_domain::entities::{CategoriaEstoque, ItemEstoque};
use clarituz_domain::ports::{AtualizaItem, EstoqueRepository, Movimentacao, NovoItem};
use clarituz_domain::queries::MovimentoView;
use clarituz_domain::DomainError;
use clarituz_shared::{money, Page, PageParams};
use rust_decimal::Decimal;
use std::sync::Arc;

pub struct EstoqueService {
    repo: Arc<dyn EstoqueRepository>,
}

impl EstoqueService {
    pub fn new(repo: Arc<dyn EstoqueRepository>) -> Self {
        Self { repo }
    }

    // -- categorias ------------------------------------------------------------

    pub async fn listar_categorias(&self, apenas_ativas: bool) -> AppResult<Vec<CategoriaEstoque>> {
        self.repo
            .listar_categorias(apenas_ativas)
            .await
            .map_err(Into::into)
    }

    pub async fn criar_categoria(
        &self,
        ator: &Ator,
        input: NomeInput,
    ) -> AppResult<CategoriaEstoque> {
        let nome = input.nome.trim();
        if nome.is_empty() {
            return Err(DomainError::validacao("Nome é obrigatório.").into());
        }
        let log = ator.log(
            "cadastro",
            format!("Cadastrou a categoria de estoque '{nome}'"),
            "categoriaestoque",
            0,
            None,
        );
        Ok(self.repo.criar_categoria(nome, log).await?)
    }

    pub async fn status_categoria(
        &self,
        ator: &Ator,
        id: i64,
        ativo: bool,
    ) -> AppResult<CategoriaEstoque> {
        ator.exigir_admin()?;
        let log = ator.log(
            "status",
            format!("Alterou status da categoria Nº{id}"),
            "categoriaestoque",
            id,
            None,
        );
        Ok(self.repo.definir_categoria_ativa(id, ativo, log).await?)
    }

    /// Roteamento KOT — define para qual impressora de setor os itens
    /// desta categoria imprimem ticket de produção (`None` = sem ticket).
    pub async fn definir_impressora_categoria(
        &self,
        ator: &Ator,
        id: i64,
        impressora_id: Option<i64>,
    ) -> AppResult<CategoriaEstoque> {
        ator.exigir_admin()?;
        let log = ator.log(
            "edição",
            format!("Roteou a categoria Nº{id} para impressora {impressora_id:?}"),
            "categoriaestoque",
            id,
            None,
        );
        Ok(self
            .repo
            .definir_impressora_categoria(id, impressora_id, log)
            .await?)
    }

    // -- itens ------------------------------------------------------------------

    pub async fn buscar_item(&self, id: i64) -> AppResult<ItemEstoque> {
        self.repo
            .buscar_item(id)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Item não encontrado.").into())
    }

    pub async fn listar_itens(
        &self,
        apenas_ativos: bool,
        page: PageParams,
    ) -> AppResult<Page<ItemEstoque>> {
        self.repo
            .listar_itens(apenas_ativos, page)
            .await
            .map_err(Into::into)
    }

    pub async fn criar_item(&self, ator: &Ator, input: ItemEstoqueInput) -> AppResult<ItemEstoque> {
        let nome = input.nome.trim();
        if nome.is_empty() {
            return Err(DomainError::validacao("Nome é obrigatório.").into());
        }
        let qtd = input.quantidade_inicial.unwrap_or(0);
        if qtd < 0 {
            return Err(DomainError::validacao("Quantidade inicial inválida.").into());
        }
        let valor = input.valor_unitario.unwrap_or(Decimal::ZERO);
        if valor < Decimal::ZERO {
            return Err(DomainError::validacao("Valor unitário inválido.").into());
        }

        let novo = NovoItem {
            nome: nome.to_string(),
            idcategoria: input.idcategoria,
            quantidade_inicial: qtd,
            valor_unitario: money::round2(valor),
        };
        let log = ator.log(
            "cadastro",
            format!("Cadastrou o item '{nome}' com {qtd} unidade(s)"),
            "estoque",
            0,
            None,
        );
        Ok(self.repo.criar_item(&novo, ator.id, log).await?)
    }

    pub async fn atualizar_item(
        &self,
        ator: &Ator,
        id: i64,
        input: ItemEstoqueUpdate,
    ) -> AppResult<ItemEstoque> {
        self.buscar_item(id).await?;
        if let Some(v) = input.valor_unitario {
            if v < Decimal::ZERO {
                return Err(DomainError::validacao("Valor unitário inválido.").into());
            }
        }
        let dados = AtualizaItem {
            nome: input
                .nome
                .map(|n| n.trim().to_string())
                .filter(|n| !n.is_empty()),
            idcategoria: input.idcategoria,
            valor_unitario: input.valor_unitario.map(money::round2),
            version: input.version,
        };
        let log = ator.log(
            "edição",
            format!("Editou o item de estoque Nº{id}"),
            "estoque",
            id,
            None,
        );
        Ok(self.repo.atualizar_item(id, &dados, log).await?)
    }

    pub async fn status_item(&self, ator: &Ator, id: i64, ativo: bool) -> AppResult<ItemEstoque> {
        ator.exigir_admin()?;
        self.buscar_item(id).await?;
        let log = ator.log(
            "status",
            format!("Alterou status do item Nº{id}"),
            "estoque",
            id,
            None,
        );
        Ok(self.repo.definir_item_ativo(id, ativo, log).await?)
    }

    /// Entradas/saídas em lote (equivalente a `gEntrada.php`/`gSaida.php`),
    /// com a vantagem de ser uma transação única.
    pub async fn movimentar(&self, ator: &Ator, req: MovimentacoesRequest) -> AppResult<u64> {
        if req.movimentos.is_empty() {
            return Err(DomainError::validacao("Nenhuma movimentação informada.").into());
        }
        let movimentos: Vec<Movimentacao> = req
            .movimentos
            .into_iter()
            .map(|m| Movimentacao {
                iditem: m.iditem,
                tipo: m.tipo,
                quantidade: m.quantidade,
                motivo: m.motivo.unwrap_or_else(|| {
                    match m.tipo {
                        clarituz_domain::enums::TipoMovimento::Entrada => "compra",
                        clarituz_domain::enums::TipoMovimento::Saida => "venda",
                    }
                    .to_string()
                }),
            })
            .collect();

        if movimentos
            .iter()
            .any(|m| m.iditem <= 0 || m.quantidade <= 0)
        {
            return Err(DomainError::validacao(
                "Item e quantidade (>0) são obrigatórios em cada movimentação.",
            )
            .into());
        }

        let log = ator.log(
            "movimentação",
            format!(
                "Registrou {} movimentação(ões) de estoque",
                movimentos.len()
            ),
            "estoque",
            0,
            None,
        );
        Ok(self.repo.movimentar(&movimentos, ator.id, log).await?)
    }

    pub async fn listar_movimentos(
        &self,
        iditem: Option<i64>,
        page: PageParams,
    ) -> AppResult<Page<MovimentoView>> {
        self.repo
            .listar_movimentos(iditem, page)
            .await
            .map_err(Into::into)
    }
}
