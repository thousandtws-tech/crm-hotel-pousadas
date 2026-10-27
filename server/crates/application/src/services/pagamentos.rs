//! Casos de uso das formas de pagamento.

use crate::actor::Ator;
use crate::dto::NomeInput;
use crate::error::AppResult;
use clarituz_domain::entities::FormaPagamento;
use clarituz_domain::ports::FormaPagamentoRepository;
use clarituz_domain::DomainError;
use std::sync::Arc;

pub struct PagamentoService {
    repo: Arc<dyn FormaPagamentoRepository>,
}

impl PagamentoService {
    pub fn new(repo: Arc<dyn FormaPagamentoRepository>) -> Self {
        Self { repo }
    }

    pub async fn listar(&self, apenas_ativas: bool) -> AppResult<Vec<FormaPagamento>> {
        self.repo.listar(apenas_ativas).await.map_err(Into::into)
    }

    pub async fn criar(&self, ator: &Ator, input: NomeInput) -> AppResult<FormaPagamento> {
        let nome = input.nome.trim();
        if nome.is_empty() {
            return Err(DomainError::validacao("Nome é obrigatório.").into());
        }
        let log = ator.log(
            "cadastro",
            format!("Cadastrou a forma de pagamento '{nome}'"),
            "formapagamento",
            0,
            None,
        );
        Ok(self.repo.criar(nome, log).await?)
    }

    pub async fn atualizar(
        &self,
        ator: &Ator,
        id: i64,
        input: NomeInput,
    ) -> AppResult<FormaPagamento> {
        let nome = input.nome.trim();
        if nome.is_empty() {
            return Err(DomainError::validacao("Nome é obrigatório.").into());
        }
        let log = ator.log(
            "edição",
            format!("Editou a forma de pagamento Nº{id}: '{nome}'"),
            "formapagamento",
            id,
            None,
        );
        Ok(self.repo.atualizar(id, nome, input.version, log).await?)
    }

    pub async fn definir_ativo(
        &self,
        ator: &Ator,
        id: i64,
        ativo: bool,
    ) -> AppResult<FormaPagamento> {
        ator.exigir_admin()?;
        let log = ator.log(
            "status",
            format!("Alterou status da forma de pagamento Nº{id}"),
            "formapagamento",
            id,
            None,
        );
        Ok(self.repo.definir_ativo(id, ativo, log).await?)
    }

    /// Remove em definitivo — falha (409) se já usada em consumos.
    pub async fn remover(&self, ator: &Ator, id: i64) -> AppResult<()> {
        ator.exigir_admin()?;
        let log = ator.log(
            "remoção",
            format!("Removeu a forma de pagamento Nº{id}"),
            "formapagamento",
            id,
            None,
        );
        Ok(self.repo.remover(id, log).await?)
    }
}
