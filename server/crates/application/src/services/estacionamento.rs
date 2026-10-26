//! Casos de uso das vagas de estacionamento.

use crate::actor::Ator;
use crate::dto::{VagaInput, VinculoAcomodacaoInput};
use crate::error::AppResult;
use clarituz_domain::entities::VagaEstacionamento;
use clarituz_domain::ports::EstacionamentoRepository;
use clarituz_domain::DomainError;
use std::sync::Arc;

pub struct EstacionamentoService {
    repo: Arc<dyn EstacionamentoRepository>,
}

impl EstacionamentoService {
    pub fn new(repo: Arc<dyn EstacionamentoRepository>) -> Self {
        Self { repo }
    }

    pub async fn listar(&self) -> AppResult<Vec<VagaEstacionamento>> {
        self.repo.listar().await.map_err(Into::into)
    }

    pub async fn criar(&self, ator: &Ator, input: VagaInput) -> AppResult<VagaEstacionamento> {
        let numero = input.numero.trim();
        if numero.is_empty() {
            return Err(DomainError::validacao("Número da vaga é obrigatório.").into());
        }
        let log = ator.log(
            "cadastro",
            format!("Cadastrou a vaga de estacionamento '{numero}'"),
            "estacionamento",
            0,
            None,
        );
        Ok(self.repo.criar(numero, log).await?)
    }

    pub async fn vincular(
        &self,
        ator: &Ator,
        id: i64,
        input: VinculoAcomodacaoInput,
    ) -> AppResult<VagaEstacionamento> {
        let log = ator.log(
            "edição",
            format!(
                "Vinculou a vaga Nº{id} à acomodação {:?}",
                input.idacomodacao
            ),
            "estacionamento",
            id,
            None,
        );
        Ok(self
            .repo
            .vincular_acomodacao(id, input.idacomodacao, log)
            .await?)
    }

    pub async fn definir_ativo(
        &self,
        ator: &Ator,
        id: i64,
        ativo: bool,
    ) -> AppResult<VagaEstacionamento> {
        ator.exigir_admin()?;
        let log = ator.log(
            "status",
            format!("Alterou status da vaga Nº{id}"),
            "estacionamento",
            id,
            None,
        );
        Ok(self.repo.definir_ativo(id, ativo, log).await?)
    }

    pub async fn remover(&self, ator: &Ator, id: i64) -> AppResult<()> {
        ator.exigir_admin()?;
        let log = ator.log(
            "remoção",
            format!("Removeu a vaga Nº{id}"),
            "estacionamento",
            id,
            None,
        );
        Ok(self.repo.remover(id, log).await?)
    }
}
