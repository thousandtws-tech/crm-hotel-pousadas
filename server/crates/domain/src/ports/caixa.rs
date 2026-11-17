use crate::entities::{CaixaMovimento, CaixaTurno, NovoLog};
use crate::enums::{StatusTurno, TipoMovimentoCaixa};
use crate::error::DomainError;
use crate::queries::{ConferenciaCaixa, MovimentoCaixaView, TurnoView};
use async_trait::async_trait;
use chrono::NaiveDate;
use clarituz_shared::{Page, PageParams};
use rust_decimal::Decimal;

#[derive(Debug, Clone)]
pub struct NovaAberturaCaixa {
    pub idconta_financeira: i64,
    pub saldo_inicial: Decimal,
    pub observacao: Option<String>,
}

#[derive(Debug, Clone)]
pub struct NovaMovCaixa {
    pub tipo: TipoMovimentoCaixa,
    pub valor: Decimal,
    pub motivo: String,
}

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
    async fn abrir(
        &self,
        nova: &NovaAberturaCaixa,
        idoperador: i64,
        log: NovoLog,
    ) -> Result<CaixaTurno, DomainError>;

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

    async fn movimentar(
        &self,
        idturno: i64,
        mov: &NovaMovCaixa,
        idfuncionario: i64,
        log: NovoLog,
    ) -> Result<CaixaMovimento, DomainError>;

    async fn conferir(&self, idturno: i64) -> Result<ConferenciaCaixa, DomainError>;

    async fn fechar(
        &self,
        idturno: i64,
        valor_contado: Decimal,
        observacao: Option<String>,
        idfuncionario: i64,
        log: NovoLog,
    ) -> Result<CaixaTurno, DomainError>;
}
