//! Casos de uso do controle de caixa — turnos de gaveta por operador.

use crate::actor::Ator;
use crate::dto::{AbrirCaixaInput, FecharCaixaInput, MovCaixaInput};
use crate::error::AppResult;
use clarituz_domain::entities::{CaixaMovimento, CaixaTurno};
use clarituz_domain::ports::{CaixaRepository, FiltroTurno, NovaAberturaCaixa, NovaMovCaixa};
use clarituz_domain::queries::{ConferenciaCaixa, MovimentoCaixaView, TurnoView};
use clarituz_domain::DomainError;
use clarituz_shared::{money, Page, PageParams};
use rust_decimal::Decimal;
use std::sync::Arc;

pub struct CaixaService {
    repo: Arc<dyn CaixaRepository>,
}

impl CaixaService {
    pub fn new(repo: Arc<dyn CaixaRepository>) -> Self {
        Self { repo }
    }

    /// Abertura de turno — o operador é o próprio ator autenticado.
    pub async fn abrir(&self, ator: &Ator, input: AbrirCaixaInput) -> AppResult<CaixaTurno> {
        if input.saldo_inicial < Decimal::ZERO {
            return Err(DomainError::validacao("Fundo de troco não pode ser negativo.").into());
        }
        let nova = NovaAberturaCaixa {
            idconta_financeira: input.idconta_financeira,
            saldo_inicial: money::round2(input.saldo_inicial),
            observacao: input.observacao.filter(|o| !o.trim().is_empty()),
        };
        let log = ator.log(
            "abertura",
            format!("Abriu turno na conta Nº{}", nova.idconta_financeira),
            "caixa_turno",
            0,
            None,
        );
        Ok(self.repo.abrir(&nova, ator.id, log).await?)
    }

    /// Turno aberto da gaveta — tela decide entre abrir ou operar.
    pub async fn turno_aberto(&self, idconta: i64) -> AppResult<Option<CaixaTurno>> {
        Ok(self.repo.turno_aberto(idconta).await?)
    }

    pub async fn buscar_turno(&self, id: i64) -> AppResult<TurnoView> {
        self.repo
            .buscar_turno(id)
            .await?
            .ok_or_else(|| DomainError::nao_encontrado("Turno não encontrado.").into())
    }

    pub async fn listar_turnos(
        &self,
        filtro: FiltroTurno,
        page: PageParams,
    ) -> AppResult<Page<TurnoView>> {
        Ok(self.repo.listar_turnos(&filtro, page).await?)
    }

    pub async fn listar_movimentos(&self, idturno: i64) -> AppResult<Vec<MovimentoCaixaView>> {
        Ok(self.repo.listar_movimentos(idturno).await?)
    }

    /// Sangria/suprimento — valida valor e motivo; saldo conferido no repo.
    pub async fn movimentar(
        &self,
        ator: &Ator,
        idturno: i64,
        input: MovCaixaInput,
    ) -> AppResult<CaixaMovimento> {
        if input.valor <= Decimal::ZERO {
            return Err(DomainError::validacao("Valor deve ser maior que zero.").into());
        }
        if input.motivo.trim().is_empty() {
            return Err(DomainError::validacao("Motivo é obrigatório.").into());
        }
        let mov = NovaMovCaixa {
            tipo: input.tipo,
            valor: money::round2(input.valor),
            motivo: input.motivo.trim().into(),
        };
        let rotulo = match mov.tipo {
            clarituz_domain::enums::TipoMovimentoCaixa::Sangria => "sangria",
            clarituz_domain::enums::TipoMovimentoCaixa::Suprimento => "suprimento",
        };
        let log = ator.log(
            "movimento",
            format!("Registrou {rotulo} de {} no turno Nº{idturno}", mov.valor),
            "caixa_turno",
            idturno,
            None,
        );
        Ok(self.repo.movimentar(idturno, &mov, ator.id, log).await?)
    }

    /// Conferência automática — decomposição completa do esperado.
    pub async fn conferir(&self, idturno: i64) -> AppResult<ConferenciaCaixa> {
        Ok(self.repo.conferir(idturno).await?)
    }

    /// Fechamento — esperado calculado no servidor; quebra = contado − esperado.
    pub async fn fechar(
        &self,
        ator: &Ator,
        idturno: i64,
        input: FecharCaixaInput,
    ) -> AppResult<CaixaTurno> {
        if input.valor_contado < Decimal::ZERO {
            return Err(DomainError::validacao("Valor contado não pode ser negativo.").into());
        }
        let log = ator.log(
            "fechamento",
            format!("Fechou o turno Nº{idturno}"),
            "caixa_turno",
            idturno,
            None,
        );
        Ok(self
            .repo
            .fechar(
                idturno,
                money::round2(input.valor_contado),
                input.observacao.filter(|o| !o.trim().is_empty()),
                ator.id,
                log,
            )
            .await?)
    }
}
