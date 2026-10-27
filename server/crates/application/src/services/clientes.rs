//! Casos de uso de clientes.

use crate::actor::Ator;
use crate::dto::ClienteInput;
use crate::error::AppResult;
use clarituz_domain::entities::Cliente;
use clarituz_domain::ports::{ClienteRepository, FiltroCliente, NovoCliente};
use clarituz_domain::value_objects::{Cpf, Email};
use clarituz_domain::DomainError;
use clarituz_shared::{time, Page, PageParams};
use std::sync::Arc;

/// `Some(t)` → `None` quando vazio após trim.
fn opt_str(v: Option<String>) -> Option<String> {
    v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

pub struct ClienteService {
    repo: Arc<dyn ClienteRepository>,
}

impl ClienteService {
    pub fn new(repo: Arc<dyn ClienteRepository>) -> Self {
        Self { repo }
    }

    pub async fn buscar(&self, id: i64) -> AppResult<Cliente> {
        self.repo
            .buscar(id)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Cliente não encontrado.").into())
    }

    pub async fn listar(
        &self,
        busca: Option<String>,
        apenas_ativos: bool,
        page: PageParams,
    ) -> AppResult<Page<Cliente>> {
        self.repo
            .listar(
                &FiltroCliente {
                    busca,
                    apenas_ativos,
                },
                page,
            )
            .await
            .map_err(Into::into)
    }

    pub async fn criar(&self, ator: &Ator, input: ClienteInput) -> AppResult<Cliente> {
        let novo = self.validar(input).await?;
        self.garantir_unicidade(&novo.cpf, novo.email.as_deref(), 0)
            .await?;

        let log = ator.log(
            "cadastro",
            format!("Cadastrou o cliente {} (CPF {})", novo.nome, novo.cpf),
            "cliente",
            0,
            None,
        );
        Ok(self.repo.criar(&novo, log).await?)
    }

    pub async fn atualizar(&self, ator: &Ator, id: i64, input: ClienteInput) -> AppResult<Cliente> {
        self.buscar(id).await?;
        let dados = self.validar(input).await?;
        self.garantir_unicidade(&dados.cpf, dados.email.as_deref(), id)
            .await?;

        let log = ator.log(
            "edição",
            format!("Editou o cliente Nº{id}: {}", dados.nome),
            "cliente",
            id,
            Some(serde_json::json!({"idcliente": id, "nome": dados.nome})),
        );
        Ok(self.repo.atualizar(id, &dados, log).await?)
    }

    /// Ativa/desativa — ação administrativa (legado exige `nivel == 1`).
    pub async fn definir_ativo(&self, ator: &Ator, id: i64, ativo: bool) -> AppResult<Cliente> {
        ator.exigir_admin()?;
        self.buscar(id).await?;

        let acao = if ativo { "ativação" } else { "desativação" };
        let log = ator.log(
            acao,
            format!("{acao} do cliente Nº{id}"),
            "cliente",
            id,
            None,
        );
        Ok(self.repo.definir_ativo(id, ativo, log).await?)
    }

    /// Registra a foto capturada na recepção — arquivo já gravado no storage
    /// pela camada de API; aqui só persistimos o caminho + auditoria.
    pub async fn definir_foto(&self, ator: &Ator, id: i64, caminho: &str) -> AppResult<()> {
        self.buscar(id).await?;
        let log = ator.log(
            "foto",
            format!("Atualizou a foto do cliente Nº{id}"),
            "cliente",
            id,
            None,
        );
        Ok(self.repo.definir_foto(id, Some(caminho), log).await?)
    }

    /// Remove a foto e devolve o caminho anterior para a API apagar o arquivo.
    pub async fn remover_foto(&self, ator: &Ator, id: i64) -> AppResult<String> {
        self.buscar(id).await?;
        let anterior = self
            .repo
            .foto_caminho(id)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Cliente não possui foto."))?;
        let log = ator.log(
            "foto",
            format!("Removeu a foto do cliente Nº{id}"),
            "cliente",
            id,
            None,
        );
        self.repo.definir_foto(id, None, log).await?;
        Ok(anterior)
    }

    /// Caminho da foto no storage — `None` quando o cliente não tem foto.
    pub async fn foto_caminho(&self, id: i64) -> AppResult<Option<String>> {
        Ok(self.repo.foto_caminho(id).await?)
    }

    /// Exclui o cliente e devolve as chaves (foto + scans) para a API apagar
    /// no object store. Bloqueado (409) quando há reservas ou fichas FNRH.
    pub async fn remover(&self, ator: &Ator, id: i64) -> AppResult<Vec<String>> {
        ator.exigir_admin()?;
        let log = ator.log(
            "remoção",
            format!("Removeu o cliente Nº{id}"),
            "cliente",
            id,
            None,
        );
        Ok(self.repo.remover(id, log).await?)
    }

    async fn validar(&self, input: ClienteInput) -> AppResult<NovoCliente> {
        if input.nome.trim().is_empty() {
            return Err(DomainError::validacao("Nome é obrigatório.").into());
        }

        let cpf = Cpf::new(&input.cpf)?;
        let email = match input
            .email
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            Some(raw) => Some(Email::new(raw)?.to_string()),
            None => None,
        };

        if !Cliente::maior_de_idade(input.data_nascimento, time::hoje()) {
            return Err(DomainError::regra(
                "Cadastro não realizado: necessário ter 18 anos ou mais.",
            )
            .into());
        }

        Ok(NovoCliente {
            nome: input.nome.trim().to_string(),
            cpf: cpf.digits().to_string(),
            data_nascimento: input.data_nascimento,
            email,
            telefone: opt_str(input.telefone),
            estado: input
                .estado
                .map(|e| e.trim().to_uppercase().chars().take(2).collect())
                .filter(|s: &String| !s.is_empty()),
            cidade: opt_str(input.cidade),
            nacionalidade: opt_str(input.nacionalidade),
            naturalidade: opt_str(input.naturalidade),
            profissao: opt_str(input.profissao),
            logradouro: opt_str(input.logradouro),
            numero: opt_str(input.numero),
            complemento: opt_str(input.complemento),
            bairro: opt_str(input.bairro),
            cep: opt_str(input.cep),
            pais: opt_str(input.pais),
            version: input.version,
        })
    }

    async fn garantir_unicidade(
        &self,
        cpf: &str,
        email: Option<&str>,
        exceto_id: i64,
    ) -> AppResult<()> {
        if self.repo.cpf_em_uso(cpf, exceto_id).await? {
            return Err(DomainError::conflito("CPF já cadastrado anteriormente.").into());
        }
        if let Some(email) = email {
            if self.repo.email_em_uso(email, exceto_id).await? {
                return Err(DomainError::conflito("E-mail já cadastrado anteriormente.").into());
            }
        }
        Ok(())
    }
}
