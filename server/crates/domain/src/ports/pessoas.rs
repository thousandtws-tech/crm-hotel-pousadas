//! Ports do contexto de pessoas: funcionários, autenticação, clientes.

use crate::entities::{Cliente, ClienteDocumento, Funcionario, NovoLog, SessaoRefresh};
use crate::error::DomainError;
use async_trait::async_trait;
use chrono::{DateTime, NaiveDate, Utc};
use clarituz_shared::{Page, PageParams};
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Funcionários / autenticação
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct NovoFuncionario {
    pub nome: String,
    pub login: String,
    pub senha_hash: String,
    pub cpf: Option<String>,
    pub data_nascimento: Option<NaiveDate>,
    pub nivel: i16,
    /// `false` no auto-cadastro: a conta fica pendente até um admin ativar.
    pub ativo: bool,
}

#[derive(Debug, Clone, Default)]
pub struct AtualizaFuncionario {
    pub nome: Option<String>,
    pub login: Option<String>,
    pub cpf: Option<String>,
    pub data_nascimento: Option<NaiveDate>,
    pub nivel: Option<i16>,
    /// `Some(hash)` redefine a senha.
    pub senha_hash: Option<String>,
    /// Concorrência otimista: `Some(v)` exige `version = v` no UPDATE —
    /// divergência → 409 (registro alterado por outro usuário).
    pub version: Option<i64>,
}

#[async_trait]
pub trait FuncionarioRepository: Send + Sync {
    async fn buscar_por_login(&self, login: &str) -> Result<Option<Funcionario>, DomainError>;
    async fn buscar(&self, id: i64) -> Result<Option<Funcionario>, DomainError>;
    async fn listar(
        &self,
        page: PageParams,
        apenas_ativos: bool,
    ) -> Result<Page<Funcionario>, DomainError>;
    async fn login_em_uso(&self, login: &str, exceto_id: i64) -> Result<bool, DomainError>;
    async fn criar(&self, novo: &NovoFuncionario, log: NovoLog)
        -> Result<Funcionario, DomainError>;
    async fn atualizar(
        &self,
        id: i64,
        dados: &AtualizaFuncionario,
        log: NovoLog,
    ) -> Result<Funcionario, DomainError>;
    async fn definir_ativo(
        &self,
        id: i64,
        ativo: bool,
        log: NovoLog,
    ) -> Result<Funcionario, DomainError>;
}

#[async_trait]
pub trait LogAcessoRepository: Send + Sync {
    async fn registrar(
        &self,
        idfuncionario: i64,
        ip: Option<&str>,
        user_agent: Option<&str>,
    ) -> Result<(), DomainError>;
}

/// Persistência das sessões de refresh token.
#[async_trait]
pub trait SessaoRepository: Send + Sync {
    async fn criar(
        &self,
        idfuncionario: i64,
        token_hash: &str,
        expira_em: DateTime<Utc>,
        ip: Option<&str>,
        user_agent: Option<&str>,
    ) -> Result<Uuid, DomainError>;

    /// Retorna a sessão se existir, não estiver revogada e não expirada.
    async fn buscar_valida(&self, token_hash: &str) -> Result<Option<SessaoRefresh>, DomainError>;

    /// Rotação: revoga a sessão anterior dentro da mesma transação da criação
    /// da nova (implementado como `revogar` + `criar` sequenciais no serviço,
    /// ou atomicamente — decisão do adapter).
    async fn revogar(&self, sessao_id: Uuid) -> Result<(), DomainError>;
    async fn revogar_por_hash(&self, token_hash: &str) -> Result<(), DomainError>;
    async fn revogar_todas_do_funcionario(&self, idfuncionario: i64) -> Result<u64, DomainError>;
}

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct NovoCliente {
    pub nome: String,
    pub cpf: String,
    pub data_nascimento: NaiveDate,
    pub email: Option<String>,
    pub telefone: Option<String>,
    pub estado: Option<String>,
    pub cidade: Option<String>,
    // -- dados complementares da FNRH ----------------------------------------
    pub nacionalidade: Option<String>,
    pub naturalidade: Option<String>,
    pub profissao: Option<String>,
    pub logradouro: Option<String>,
    pub numero: Option<String>,
    pub complemento: Option<String>,
    pub bairro: Option<String>,
    pub cep: Option<String>,
    pub pais: Option<String>,
    /// Concorrência otimista — usada só no update (ignorada no create).
    pub version: Option<i64>,
}

#[derive(Debug, Clone, Default)]
pub struct FiltroCliente {
    pub busca: Option<String>,
    pub apenas_ativos: bool,
}

#[async_trait]
pub trait ClienteRepository: Send + Sync {
    async fn buscar(&self, id: i64) -> Result<Option<Cliente>, DomainError>;
    async fn listar(
        &self,
        filtro: &FiltroCliente,
        page: PageParams,
    ) -> Result<Page<Cliente>, DomainError>;
    async fn cpf_em_uso(&self, cpf: &str, exceto_id: i64) -> Result<bool, DomainError>;
    async fn email_em_uso(&self, email: &str, exceto_id: i64) -> Result<bool, DomainError>;
    async fn criar(&self, novo: &NovoCliente, log: NovoLog) -> Result<Cliente, DomainError>;
    async fn atualizar(
        &self,
        id: i64,
        dados: &NovoCliente,
        log: NovoLog,
    ) -> Result<Cliente, DomainError>;
    async fn definir_ativo(
        &self,
        id: i64,
        ativo: bool,
        log: NovoLog,
    ) -> Result<Cliente, DomainError>;
    /// Define (`Some`) ou remove (`None`) o caminho da foto do cliente.
    async fn definir_foto(
        &self,
        id: i64,
        caminho: Option<&str>,
        log: NovoLog,
    ) -> Result<(), DomainError>;
    /// Caminho da foto no storage — `None` quando cliente não existe ou não tem foto.
    async fn foto_caminho(&self, id: i64) -> Result<Option<String>, DomainError>;
    /// Histórico de reservas do cliente (relatório do legado).
    async fn total_reservas(&self, id: i64) -> Result<i64, DomainError>;
}

// ---------------------------------------------------------------------------
// Documentos de identidade do cliente
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct NovoDocumento {
    pub idcliente: i64,
    pub tipo: String,
    pub numero: String,
    pub orgao_emissor: Option<String>,
    pub uf_emissor: Option<String>,
    pub pais_emissor: Option<String>,
    pub validade: Option<NaiveDate>,
    /// Concorrência otimista — usada só no update.
    pub version: Option<i64>,
}

#[async_trait]
pub trait DocumentoRepository: Send + Sync {
    async fn listar(&self, idcliente: i64) -> Result<Vec<ClienteDocumento>, DomainError>;
    async fn buscar(&self, id: i64) -> Result<Option<ClienteDocumento>, DomainError>;
    async fn criar(
        &self,
        novo: &NovoDocumento,
        log: NovoLog,
    ) -> Result<ClienteDocumento, DomainError>;
    async fn atualizar(
        &self,
        id: i64,
        dados: &NovoDocumento,
        log: NovoLog,
    ) -> Result<ClienteDocumento, DomainError>;
    /// Remove o registro e devolve o caminho do scan para a API apagar o arquivo.
    async fn remover(&self, id: i64, log: NovoLog) -> Result<Option<String>, DomainError>;
    /// Define (`Some`) ou remove (`None`) o caminho do scan.
    async fn definir_scan(
        &self,
        id: i64,
        caminho: Option<&str>,
        log: NovoLog,
    ) -> Result<(), DomainError>;
    async fn scan_caminho(&self, id: i64) -> Result<Option<String>, DomainError>;
}

// ---------------------------------------------------------------------------
// Compartilhado — período (usado por listagens em vários contextos)
// ---------------------------------------------------------------------------

pub use crate::value_objects::PeriodoEstadia as Periodo;
