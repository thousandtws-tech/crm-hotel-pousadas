//! Contrato de leitura analítica do módulo preditivo — tudo consulta
//! somente-leitura sobre dados já persistidos; as regras de score e
//! classificação vivem no service (application), não aqui.

use async_trait::async_trait;

use crate::entities::preditivo::*;
use crate::error::DomainError;

#[async_trait]
pub trait PreditivoRepository: Send + Sync {
    /// Ocupação projetada dia a dia pelos próximos 14 dias.
    async fn ocupacao_14d(&self) -> Result<Vec<DiaOcupacao>, DomainError>;

    /// Receita prevista por semana (4 semanas) — reservas ativas somente.
    async fn receita_4sem(&self) -> Result<Vec<SemanaReceita>, DomainError>;

    /// Componentes do fluxo de caixa 30d (modelo 70/30 montado no service).
    async fn fluxo_caixa_30d(&self) -> Result<FluxoCaixaRow, DomainError>;

    /// Sinais brutos das reservas futuras p/ score de cancelamento/no-show.
    async fn reservas_risco(&self) -> Result<Vec<ReservaRiscoRow>, DomainError>;

    /// Base LTV/recência/frequência por hóspede p/ classificação.
    async fn perfis_hospedes(&self) -> Result<Vec<PerfilRow>, DomainError>;

    /// Janela móvel 30d vs mesmo período do ano anterior.
    async fn pace(&self) -> Result<PaceRow, DomainError>;

    /// Demanda diária (checkins/outs/stayovers/hóspedes) × turnos escalados
    /// por setor nos próximos 14 dias.
    async fn escala_demanda_14d(&self) -> Result<Vec<EscalaDiaRow>, DomainError>;

    /// Upgrades possíveis: reserva futura + acomodação superior livre.
    async fn upsells(&self) -> Result<Vec<Upsell>, DomainError>;

    /// Consumo médio 30d por item vendável/insumo p/ projeção de demanda.
    async fn estoque_consumo(&self) -> Result<Vec<ItemEstoqueRow>, DomainError>;

    /// Noites ocupadas × ordens de serviço por quarto (risco de falha).
    async fn risco_quartos(&self) -> Result<Vec<RiscoQuartoRow>, DomainError>;

    /// Indicadores mensais 12m: diárias, receita, reservas (contexto Inná).
    async fn historico_12m(&self) -> Result<Vec<MesHistorico>, DomainError>;
}
