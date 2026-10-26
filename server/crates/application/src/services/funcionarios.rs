//! Casos de uso de funcionários — módulo administrativo (nivel = 1).

use crate::actor::Ator;
use crate::dto::{FuncionarioInput, FuncionarioUpdate, RegistroInput};
use crate::error::AppResult;
use clarituz_domain::entities::{Funcionario, NovoLog};
use clarituz_domain::ports::{
    AtualizaFuncionario, FuncionarioRepository, NovoFuncionario, PasswordHasher,
};
use clarituz_domain::value_objects::Cpf;
use clarituz_domain::DomainError;
use clarituz_shared::{Page, PageParams};
use std::sync::Arc;

pub struct FuncionarioService {
    repo: Arc<dyn FuncionarioRepository>,
    hasher: Arc<dyn PasswordHasher>,
}

impl FuncionarioService {
    pub fn new(repo: Arc<dyn FuncionarioRepository>, hasher: Arc<dyn PasswordHasher>) -> Self {
        Self { repo, hasher }
    }

    pub async fn buscar(&self, id: i64) -> AppResult<Funcionario> {
        self.repo
            .buscar(id)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Funcionário não encontrado.").into())
    }

    pub async fn listar(
        &self,
        apenas_ativos: bool,
        page: PageParams,
    ) -> AppResult<Page<Funcionario>> {
        self.repo
            .listar(page, apenas_ativos)
            .await
            .map_err(Into::into)
    }

    /// Cadastro — restrito a administradores.
    pub async fn criar(&self, ator: &Ator, input: FuncionarioInput) -> AppResult<Funcionario> {
        ator.exigir_admin()?;

        let nome = input.nome.trim();
        let login = input.login.trim().to_lowercase();
        if nome.is_empty() || login.is_empty() {
            return Err(DomainError::validacao("Nome e login são obrigatórios.").into());
        }
        if input.senha.len() < 8 {
            return Err(DomainError::validacao("Senha deve ter ao menos 8 caracteres.").into());
        }
        if input.nivel < 1 {
            return Err(DomainError::validacao("Nível de acesso inválido.").into());
        }
        let cpf = match input
            .cpf
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            Some(raw) => Some(Cpf::new(raw)?.digits().to_string()),
            None => None,
        };
        if self.repo.login_em_uso(&login, 0).await? {
            return Err(DomainError::conflito(format!("Login {login} em uso.")).into());
        }

        let novo = NovoFuncionario {
            nome: nome.to_string(),
            login: login.clone(),
            senha_hash: self.hasher.hash(&input.senha)?,
            cpf,
            data_nascimento: input.data_nascimento,
            nivel: input.nivel,
            ativo: true,
        };
        let log = ator.log(
            "cadastro",
            format!("Cadastrou o funcionário '{login}' (nível {})", input.nivel),
            "funcionario",
            0,
            None,
        );
        Ok(self.repo.criar(&novo, log).await?)
    }

    /// Auto-cadastro pela tela de login — cria conta de **administrador**
    /// (nível 1, ativa). Os demais níveis (Recepção, Gerente) são criados
    /// pelo admin no painel (Administrador → Funcionários). Nunca confie no
    /// nível vindo do cliente.
    pub async fn registrar(&self, input: RegistroInput) -> AppResult<Funcionario> {
        let nome = input.nome.trim();
        let login = input.login.trim().to_lowercase();
        if nome.is_empty() || login.is_empty() {
            return Err(DomainError::validacao("Nome e login são obrigatórios.").into());
        }
        if input.senha.len() < 8 {
            return Err(DomainError::validacao("Senha deve ter ao menos 8 caracteres.").into());
        }
        if self.repo.login_em_uso(&login, 0).await? {
            return Err(DomainError::conflito(format!("Login {login} em uso.")).into());
        }

        let novo = NovoFuncionario {
            nome: nome.to_string(),
            login: login.clone(),
            senha_hash: self.hasher.hash(&input.senha)?,
            cpf: None,
            data_nascimento: None,
            nivel: 1,
            ativo: true,
        };
        let log = NovoLog {
            idfuncionario: None,
            acao: "auto-cadastro".into(),
            obs: format!("'{login}' cadastrou-se como administrador pela tela de login."),
            tabela: "funcionario",
            idtabela: 0,
            dados: None,
        };
        Ok(self.repo.criar(&novo, log).await?)
    }

    pub async fn atualizar(
        &self,
        ator: &Ator,
        id: i64,
        input: FuncionarioUpdate,
    ) -> AppResult<Funcionario> {
        ator.exigir_admin()?;
        self.buscar(id).await?;

        let login = input.login.map(|l| l.trim().to_lowercase());
        if let Some(l) = &login {
            if l.is_empty() {
                return Err(DomainError::validacao("Login inválido.").into());
            }
            if self.repo.login_em_uso(l, id).await? {
                return Err(DomainError::conflito(format!("Login {l} em uso.")).into());
            }
        }

        let senha_hash = match input
            .senha
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            Some(s) if s.len() < 8 => {
                return Err(DomainError::validacao("Senha deve ter ao menos 8 caracteres.").into())
            }
            Some(s) => Some(self.hasher.hash(s)?),
            None => None,
        };

        let cpf = match input
            .cpf
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            Some(raw) => Some(Cpf::new(raw)?.digits().to_string()),
            None => None,
        };

        let dados = AtualizaFuncionario {
            nome: input
                .nome
                .map(|n| n.trim().to_string())
                .filter(|n| !n.is_empty()),
            login,
            cpf,
            data_nascimento: input.data_nascimento,
            nivel: input.nivel,
            senha_hash,
            version: input.version,
        };
        let log = ator.log(
            "edição",
            format!("Editou o funcionário Nº{id}"),
            "funcionario",
            id,
            None,
        );
        Ok(self.repo.atualizar(id, &dados, log).await?)
    }

    pub async fn definir_ativo(&self, ator: &Ator, id: i64, ativo: bool) -> AppResult<Funcionario> {
        ator.exigir_admin()?;
        if id == ator.id && !ativo {
            return Err(DomainError::regra("Não é possível desativar o próprio usuário.").into());
        }
        self.buscar(id).await?;
        let acao = if ativo { "ativação" } else { "desativação" };
        let log = ator.log(
            acao,
            format!("{acao} do funcionário Nº{id}"),
            "funcionario",
            id,
            None,
        );
        Ok(self.repo.definir_ativo(id, ativo, log).await?)
    }
}
