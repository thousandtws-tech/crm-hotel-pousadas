use async_trait::async_trait;
use chrono::{DateTime, NaiveDate, Utc};

use crate::entities::{
    EnxovalMov, EscalaTurno, FuncionarioJornada, GovernancaTarefa, LavanderiaLote, ManutencaoOrdem,
    PmocRegistro,
};
use crate::enums::{OrigemTurno, StatusManut, StatusTarefaGov, TipoTarefaGov};
use crate::error::DomainError;

// ---------------------------------------------------------------------------
// manutenção & PMOC
// ---------------------------------------------------------------------------

#[async_trait]
pub trait ManutencaoRepository: Send + Sync {
    async fn criar_ordem(&self, ordem: &NovaOrdem) -> Result<ManutencaoOrdem, DomainError>;
    async fn ordens(
        &self,
        status: Option<StatusManut>,
    ) -> Result<Vec<ManutencaoOrdem>, DomainError>;
    async fn mudar_status(
        &self,
        id: i64,
        status: StatusManut,
        custo_centavos: Option<i64>,
    ) -> Result<ManutencaoOrdem, DomainError>;
    async fn pmoc_registrar(&self, reg: &NovoPmoc) -> Result<PmocRegistro, DomainError>;
    async fn pmoc_listar(&self) -> Result<Vec<PmocRegistro>, DomainError>;
    /// Competências com PMOC em atraso (proxima_data < hoje e sem registro novo).
    async fn pmoc_atraso(&self, hoje: NaiveDate) -> Result<Option<PmocRegistro>, DomainError>;
}

#[derive(Debug, Clone)]
pub struct NovaOrdem {
    pub idquarto: Option<i64>,
    pub local: String,
    pub titulo: String,
    pub descricao: String,
    pub prioridade: crate::enums::PrioridadeManut,
    pub materiais: serde_json::Value,
    pub responsavel: Option<String>,
    pub idfuncionario: Option<i64>,
    pub criado_por: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct NovoPmoc {
    pub referente_a: NaiveDate,
    pub itens: serde_json::Value,
    pub conformes: i16,
    pub responsavel_nome: String,
    pub responsavel_crea: String,
    pub responsavel_art: String,
    pub observacoes: String,
    pub proxima_data: Option<NaiveDate>,
    pub criado_por: Option<i64>,
}

// ---------------------------------------------------------------------------
// governança
// ---------------------------------------------------------------------------

#[async_trait]
pub trait GovernancaRepository: Send + Sync {
    async fn tarefas_dia(&self, data: NaiveDate) -> Result<Vec<GovernancaTarefa>, DomainError>;
    async fn tarefas_periodo(
        &self,
        inicio: NaiveDate,
        fim: NaiveDate,
    ) -> Result<Vec<GovernancaTarefa>, DomainError>;
    async fn criar_tarefa(&self, t: &NovaTarefa) -> Result<GovernancaTarefa, DomainError>;
    /// Idempotente — UNIQUE (idquarto,data,tipo) vira no-op.
    async fn criar_tarefa_se_ausente(&self, t: &NovaTarefa) -> Result<bool, DomainError>;
    async fn mudar_status_tarefa(
        &self,
        id: i64,
        status: StatusTarefaGov,
    ) -> Result<GovernancaTarefa, DomainError>;
    async fn atribuir(&self, id: i64, idfuncionario: i64) -> Result<GovernancaTarefa, DomainError>;

    /// Quartos com checkout no dia (reserva sai = limpeza completa).
    async fn checkouts_do_dia(&self, data: NaiveDate) -> Result<Vec<i64>, DomainError>;
    /// Quartos ocupados que ficam (stayover) no dia.
    async fn stayovers_do_dia(&self, data: NaiveDate) -> Result<Vec<i64>, DomainError>;
    /// Capacidade da equipe em minutos no dia (turnos de setor=governanca).
    async fn capacidade_governanca_min(&self, data: NaiveDate) -> Result<i64, DomainError>;

    async fn lav_lotes(
        &self,
        competencia: Option<NaiveDate>,
    ) -> Result<Vec<LavanderiaLote>, DomainError>;
    async fn lav_abrir(&self, lote: &NovoLote) -> Result<LavanderiaLote, DomainError>;
    async fn lav_devolver(
        &self,
        id: i64,
        qtd_devolvida: i32,
        custo_centavos: Option<i64>,
    ) -> Result<LavanderiaLote, DomainError>;
    /// Fecha o mês: marca lotes e gera conta a pagar consolidada.
    async fn lav_fechar_competencia(&self, competencia: NaiveDate) -> Result<i64, DomainError>;
    async fn enxoval_mov(&self, limite: i64) -> Result<Vec<EnxovalMov>, DomainError>;
    async fn enxoval_registrar(&self, m: &NovoMovEnxoval) -> Result<(), DomainError>;
    /// Posição por tipo de peça (entradas - saídas).
    async fn enxoval_saldo(&self) -> Result<Vec<(String, i64)>, DomainError>;
}

#[derive(Debug, Clone)]
pub struct NovaTarefa {
    pub idquarto: Option<i64>,
    pub data: NaiveDate,
    pub tipo: TipoTarefaGov,
    pub estimado_min: i16,
    pub idfuncionario: Option<i64>,
    pub origem: String,
    pub observacao: String,
}

#[derive(Debug, Clone)]
pub struct NovoLote {
    pub fornecedor: String,
    pub competencia: NaiveDate,
    pub qtd_itens: i32,
    pub custo_centavos: i64,
    pub observacao: String,
}

#[derive(Debug, Clone)]
pub struct NovoMovEnxoval {
    pub tipo_item: String,
    pub quantidade: i32,
    pub origem: String,
    pub destino: String,
    pub idlote: Option<i64>,
    pub idquarto: Option<i64>,
    pub registrado_por: Option<i64>,
}

// ---------------------------------------------------------------------------
// escalas
// ---------------------------------------------------------------------------

#[async_trait]
pub trait EscalaRepository: Send + Sync {
    async fn gravar_jornada(&self, j: &FuncionarioJornada) -> Result<(), DomainError>;
    async fn jornadas(&self) -> Result<Vec<FuncionarioJornada>, DomainError>;
    async fn jornada_de(
        &self,
        idfuncionario: i64,
    ) -> Result<Option<FuncionarioJornada>, DomainError>;
    async fn turnos(
        &self,
        inicio: NaiveDate,
        fim: NaiveDate,
        idfuncionario: Option<i64>,
    ) -> Result<Vec<EscalaTurno>, DomainError>;
    /// Upsert por (idfuncionario,data) — regeneração de jornada é idempotente.
    async fn gravar_turno(&self, t: &NovoTurno) -> Result<(), DomainError>;
    async fn remover_turno(&self, id: i64) -> Result<(), DomainError>;
    /// Nome do funcionário p/ mensagens de violação.
    async fn nome_funcionario(&self, id: i64) -> Result<String, DomainError>;
    /// Todos os funcionários ativos com jornada configurada.
    async fn com_jornada(&self) -> Result<Vec<i64>, DomainError>;
    async fn turno_por_id(&self, id: i64) -> Result<Option<EscalaTurno>, DomainError>;
    async fn ajustar_turno(
        &self,
        id: i64,
        inicio: DateTime<Utc>,
        fim: DateTime<Utc>,
        almoco_min: i16,
        origem: OrigemTurno,
    ) -> Result<EscalaTurno, DomainError>;
}

#[derive(Debug, Clone)]
pub struct NovoTurno {
    pub idfuncionario: i64,
    pub data: NaiveDate,
    pub inicio: DateTime<Utc>,
    pub fim: DateTime<Utc>,
    pub almoco_min: i16,
    pub origem: OrigemTurno,
}
