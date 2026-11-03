//! Port do controle de caixa — turnos de gaveta por operador.
//!
//! Invariantes centrais:
//! * uma `conta_financeira` admite no máximo um turno aberto (índice parcial);
//! * sangria/suprimento só existem em turno aberto;
//! * o fechamento calcula `valor_esperado` no servidor — nunca da requisição;
//! * `quebra = valor_contado − valor_esperado` é gravado junto com o fechamento.

use crate::entities::{CaixaMovimento, CaixaTurno, NovoLog};
use crate::enums::{StatusTurno, TipoMovimentoCaixa};
use crate::error::DomainError;
use crate::queries::{ConferenciaCaixa, MovimentoCaixaView, TurnoView};
use async_trait::async_trait;
use chrono::NaiveDate;
use clarituz_shared::{Page, PageParams};
use rust_decimal::Decimal;

/// Abertura de turno (fundo de troco + gaveta).
#[derive(Debug, Clone)]
pub struct NovaAberturaCaixa {
    pub idconta_financeira: i64,
    pub saldo_inicial: Decimal,
    pub observacao: Option<String>,
}

/// Sangria/suprimento dentro do turno.
#[derive(Debug, Clone)]
pub struct NovaMovCaixa {
    pub tipo: TipoMovimentoCaixa,
    pub valor: Decimal,
    pub motivo: String,
}

/// Filtro de histórico de turnos.
#[derive(Debug, Clone, Default)]
pub struct FiltroTurno {
    pub idconta_financeira: Option<i64>,
    pub status: Option<StatusTurno>,
    pub idoperador: Option<i64>,
    pub inicio: Option<NaiveDate>,
    pub fim: Option<NaiveDate>,
}

#[async_trait]
pub trait CaixaRepository: Send + Sync {
    /// Abre turno — falha (409) se a gaveta já tiver turno aberto.
    async fn abrir(
        &self,
        nova: &NovaAberturaCaixa,
        idoperador: i64,
        log: NovoLog,
    ) -> Result<CaixaTurno, DomainError>;

    /// Turno aberto da gaveta (para a UI saber se mostra abertura ou painel).
    async fn turno_aberto(
        &self,
        idconta_financeira: i64,
    ) -> Result<Option<CaixaTurno>, DomainError>;

    async fn buscar_turno(&self, id: i64) -> Result<Option<TurnoView>, DomainError>;

    async fn listar_turnos(
        &self,
        filtro: &FiltroTurno,
        page: PageParams,
    ) -> Result<Page<TurnoView>, DomainError>;

    async fn listar_movimentos(&self, idturno: i64)
        -> Result<Vec<MovimentoCaixaView>, DomainError>;

    /// Registra sangria/suprimento — tx: valida turno aberto + auditoria.
    /// Sangria não pode superar o esperado corrente na gaveta.
    async fn movimentar(
        &self,
        idturno: i64,
        mov: &NovaMovCaixa,
        idfuncionario: i64,
        log: NovoLog,
    ) -> Result<CaixaMovimento, DomainError>;

    /// Conferência automática — decomposição do valor esperado (read-only).
    async fn conferir(&self, idturno: i64) -> Result<ConferenciaCaixa, DomainError>;

    /// Fechamento — tx única: trava o turno, calcula esperado + quebra,
    /// marca `fechado` e audita. `valor_contado` vem da contagem física.
    async fn fechar(
        &self,
        idturno: i64,
        valor_contado: Decimal,
        observacao: Option<String>,
        idfuncionario: i64,
        log: NovoLog,
    ) -> Result<CaixaTurno, DomainError>;
}
