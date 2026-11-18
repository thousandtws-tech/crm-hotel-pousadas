//! Ports do contexto de pessoas: funcionários, autenticação, clientes.

use crate::entities::{Cargo, Cliente, ClienteDocumento, Funcionario, NovoLog, SessaoRefresh};
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
    pub cargo_id: i64,
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
    pub cargo_id: Option<i64>,
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
    /// Remove em definitivo (sessões, acessos e leituras de notificação
    /// junto) — falha (409) se houver histórico de ações/reservas.
    async fn remover(&self, id: i64, log: NovoLog) -> Result<(), DomainError>;
}

// ---------------------------------------------------------------------------
// Cargos — título + nível de acesso
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct NovoCargo {
    pub nome: String,
    pub descricao: Option<String>,
    pub nivel: i16,
}

#[derive(Debug, Clone, Default)]
pub struct AtualizaCargo {
    pub nome: Option<String>,
    pub descricao: Option<String>,
    pub nivel: Option<i16>,
    pub ativo: Option<bool>,
}

#[async_trait]
pub trait CargoRepository: Send + Sync {
    async fn buscar(&self, id: i64) -> Result<Option<Cargo>, DomainError>;
    /// Cargo ativo cujo `nivel` corresponde — usado para mapear o nível
    /// legado do auto-cadastro (admin) no cargo-base.
    async fn buscar_por_nivel(&self, nivel: i16) -> Result<Option<Cargo>, DomainError>;
    /// Lista com a contagem de funcionários vinculados (`total_funcionarios`).
    async fn listar(&self, apenas_ativos: bool) -> Result<Vec<Cargo>, DomainError>;
    async fn nome_em_uso(&self, nome: &str, exceto_id: i64) -> Result<bool, DomainError>;
    async fn criar(&self, novo: &NovoCargo) -> Result<Cargo, DomainError>;
    async fn atualizar(&self, id: i64, dados: &AtualizaCargo) -> Result<Cargo, DomainError>;
    /// Remove em definitivo — falha (409) se houver funcionário vinculado.
    async fn remover(&self, id: i64) -> Result<(), DomainError>;
}

#[async_trait]
pub trait LogAcessoRepository: Send + Sync {
    async fn registrar(
        &self,
        idfuncionario: i64,
        ip: Option<&str>,
        user_agent: Option<&str>,
    ) -> Result<(), DomainError>;

    /// Marco Civil art. 15 — piso legal de 6 meses para registros de
    /// acesso a aplicações; Decreto 8.771/16 art. 13 §2º — excluídos
    /// assim que encerrado o prazo legal (minimização). Remove exatamente
    /// o que passou do piso. Retorna as linhas removidas.
    async fn purgar_vencidos(&self) -> Result<u64, DomainError>;
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

    /// Sessões mortas (revogadas ou expiradas) há mais de 6 meses — o
    /// mesmo piso dos registros de acesso; além dele o IP/user-agent
    /// guardado é dado pessoal sem finalidade legal. Retorna removidas.
    async fn purgar_expiradas(&self) -> Result<u64, DomainError>;
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

/// Cadastro mínimo enviado pelo formulário de reserva do site — campos
/// de ficha (endereço, profissão…) ficam para o check-in/FNRH.
#[derive(Debug, Clone)]
pub struct NovoClienteSite {
    pub nome: String,
    /// CPF definitivo gravado no cadastro (limpo ou fallback `SITE-…`).
    pub cpf: String,
    /// CPF limpo usado só para localizar cadastro existente (≥ 11 dígitos).
    pub cpf_busca: Option<String>,
    pub email: String,
    pub telefone: String,
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
    /// Reserva online: localiza pelo e-mail (case-insensitive) ou CPF,
    /// atualiza o contato; senão, cria cadastro mínimo. Devolve o id —
    /// não escreve auditoria (o `NovoLog` da reserva cobre a ação).
    async fn site_upsert(&self, dados: &NovoClienteSite) -> Result<i64, DomainError>;
    /// Consentimento transacional de WhatsApp (checkbox da reserva do
    /// site) — independente do consentimento de marketing (LGPD).
    async fn site_consent_whatsapp(&self, idcliente: i64, optin: bool) -> Result<(), DomainError>;
    /// Remove o cliente e seus documentos (cascade) — falha (409) se houver
    /// reservas, fichas FNRH ou vínculo como acompanhante. Devolve as chaves
    /// (foto + scans) para a camada de API apagar no object store.
    async fn remover(&self, id: i64, log: NovoLog) -> Result<Vec<String>, DomainError>;
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
