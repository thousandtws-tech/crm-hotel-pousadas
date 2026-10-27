//! Casos de uso de frigobar.

use crate::actor::Ator;
use crate::dto::{FrigobarInput, ItemFrigobarInput, QuantidadeInput};
use crate::error::AppResult;
use clarituz_domain::entities::{Frigobar, ItemFrigobar};
use clarituz_domain::ports::{AcomodacaoRepository, FrigobarRepository, NovoFrigobar};
use clarituz_domain::queries::ItemFrigobarView;
use clarituz_domain::DomainError;
use std::sync::Arc;

pub struct FrigobarService {
    repo: Arc<dyn FrigobarRepository>,
    acomodacoes: Arc<dyn AcomodacaoRepository>,
}

impl FrigobarService {
    pub fn new(
        repo: Arc<dyn FrigobarRepository>,
        acomodacoes: Arc<dyn AcomodacaoRepository>,
    ) -> Self {
        Self { repo, acomodacoes }
    }

    pub async fn listar(&self) -> AppResult<Vec<Frigobar>> {
        self.repo.listar().await.map_err(Into::into)
    }

    pub async fn listar_por_acomodacao(&self, idacomodacao: i64) -> AppResult<Vec<Frigobar>> {
        self.repo
            .listar_por_acomodacao(idacomodacao)
            .await
            .map_err(Into::into)
    }

    pub async fn criar(&self, ator: &Ator, input: FrigobarInput) -> AppResult<Frigobar> {
        self.acomodacoes
            .buscar(input.idacomodacao)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Acomodação não encontrada."))?;

        let novo = NovoFrigobar {
            idacomodacao: input.idacomodacao,
            modelo: input.modelo,
            patrimonio: input.patrimonio,
            version: None,
        };
        let log = ator.log(
            "cadastro",
            format!("Cadastrou frigobar na acomodação Nº{}", novo.idacomodacao),
            "frigobar",
            0,
            None,
        );
        Ok(self.repo.criar(&novo, log).await?)
    }

    pub async fn atualizar(
        &self,
        ator: &Ator,
        id: i64,
        input: FrigobarInput,
    ) -> AppResult<Frigobar> {
        self.buscar(id).await?;
        let dados = NovoFrigobar {
            idacomodacao: input.idacomodacao,
            modelo: input.modelo,
            patrimonio: input.patrimonio,
            version: input.version,
        };
        let log = ator.log(
            "edição",
            format!("Editou o frigobar Nº{id}"),
            "frigobar",
            id,
            None,
        );
        Ok(self.repo.atualizar(id, &dados, log).await?)
    }

    pub async fn definir_ativo(&self, ator: &Ator, id: i64, ativo: bool) -> AppResult<Frigobar> {
        ator.exigir_admin()?;
        self.buscar(id).await?;
        let log = ator.log(
            "status",
            format!("Alterou status do frigobar Nº{id}"),
            "frigobar",
            id,
            None,
        );
        Ok(self.repo.definir_ativo(id, ativo, log).await?)
    }

    pub async fn itens(&self, idfrigobar: i64) -> AppResult<Vec<ItemFrigobarView>> {
        self.buscar(idfrigobar).await?;
        self.repo.listar_itens(idfrigobar).await.map_err(Into::into)
    }

    /// Reposição: debita o estoque central e credita o frigobar na mesma tx.
    pub async fn repor_item(
        &self,
        ator: &Ator,
        idfrigobar: i64,
        input: ItemFrigobarInput,
    ) -> AppResult<ItemFrigobar> {
        self.buscar(idfrigobar).await?;
        if input.quantidade <= 0 {
            return Err(DomainError::validacao("Quantidade deve ser maior que zero.").into());
        }
        let log = ator.log(
            "reposição",
            format!(
                "Repôs {} unidade(s) no frigobar Nº{idfrigobar}",
                input.quantidade
            ),
            "itemfrigobar",
            0,
            None,
        );
        Ok(self
            .repo
            .repor_item(idfrigobar, input.iditem, input.quantidade, ator.id, log)
            .await?)
    }

    pub async fn ajustar_item(
        &self,
        ator: &Ator,
        id: i64,
        input: QuantidadeInput,
    ) -> AppResult<ItemFrigobar> {
        if input.quantidade < 0 {
            return Err(DomainError::validacao("Quantidade inválida.").into());
        }
        let log = ator.log(
            "edição",
            format!("Ajustou o item de frigobar Nº{id}"),
            "itemfrigobar",
            id,
            None,
        );
        Ok(self
            .repo
            .atualizar_item(id, input.quantidade, input.version, log)
            .await?)
    }

    pub async fn status_item(&self, ator: &Ator, id: i64, ativo: bool) -> AppResult<()> {
        ator.exigir_admin()?;
        let log = ator.log(
            "status",
            format!("Alterou status do item de frigobar Nº{id}"),
            "itemfrigobar",
            id,
            None,
        );
        Ok(self.repo.definir_item_ativo(id, ativo, log).await?)
    }

    pub async fn remover_item(&self, ator: &Ator, id: i64) -> AppResult<()> {
        ator.exigir_admin()?;
        let log = ator.log(
            "remoção",
            format!("Removeu o item de frigobar Nº{id}"),
            "itemfrigobar",
            id,
            None,
        );
        Ok(self.repo.remover_item(id, log).await?)
    }

    /// Remove o frigobar inteiro junto com seus itens — uma transação.
    pub async fn remover(&self, ator: &Ator, id: i64) -> AppResult<()> {
        ator.exigir_admin()?;
        let log = ator.log(
            "remoção",
            format!("Removeu o frigobar Nº{id}"),
            "frigobar",
            id,
            None,
        );
        Ok(self.repo.remover(id, log).await?)
    }

    pub async fn buscar(&self, id: i64) -> AppResult<Frigobar> {
        self.repo
            .buscar(id)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Frigobar não encontrado.").into())
    }
}
