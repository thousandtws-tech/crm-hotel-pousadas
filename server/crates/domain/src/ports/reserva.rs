//! Ports do agregado Reserva — operações transacionais de negócio.
//!
//! Cada método mutador é **uma transação atômica** na implementação:
//! entidade + consumo + ledger + auditoria, tudo ou nada.

use crate::entities::{
    Acompanhante, AdicionalConsumo, Bloqueio, Consumo, Fnrh, Grupo, GrupoUnidadeView,
    ItemConsumido, NovoLog, Reembolso, Reserva,
};
use crate::enums::StatusReserva;
use crate::error::DomainError;
use crate::queries::{
    AcomodacaoDisponivel, ComprovanteResumo, MapaQuarto, ReservaDetalhe, ReservaResumo,
};
use crate::value_objects::PeriodoEstadia;
use async_trait::async_trait;
use chrono::{DateTime, NaiveDate, Utc};
use clarituz_shared::{Page, PageParams};
use rust_decimal::Decimal;
use serde_json::Value as JsonValue;

#[derive(Debug, Clone)]
pub struct NovaReserva {
    pub idacomodacao: i64,
    pub idcliente: i64,
    pub quantidade_hospedes: i32,
    pub periodo: PeriodoEstadia,
    pub obs: Option<String>,
    pub valordiaria: Decimal,
    /// Valor total da estadia gravado em `consumo.valor_estadia`.
    pub valor_total: Decimal,
    /// Entrada antecipada / saída estendida — taxas já embutidas no total.
    pub early_checkin: bool,
    pub late_checkout: bool,
    /// Prazo de hold da reserva online (None = recepção, sem expiração).
    pub expira_em: Option<DateTime<Utc>>,
    /// Operadora B2B de origem (extranet) — None em venda direta.
    pub idoperadora: Option<i64>,
    /// Contrato corporativo aplicado (código público do motor).
    pub idcontrato: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct ComandoCheckout {
    pub idreserva: i64,
    pub idforma_pagamento: i64,
    pub valor_estadia: Decimal,
    pub total_desconto: Decimal,
    pub valor_final: Decimal,
    /// Lançamentos avulsos criados no fechamento.
    pub adicionais: Vec<NovoAdicional>,
    /// Nome do arquivo de comprovante gerado pela aplicação.
    pub comprovante: Option<String>,
}

#[derive(Debug, Clone)]
pub struct NovoAdicional {
    pub motivo: String,
    pub valor: Decimal,
}

/// Resultado do cancelamento — informa se houve reembolso.
#[derive(Debug, Clone)]
pub struct ResultadoCancelamento {
    pub reserva: Reserva,
    pub reembolso: Option<Reembolso>,
}

#[derive(Debug, Clone)]
pub struct NovoItemConsumido {
    pub idconsumo: i64,
    /// Item do frigobar selecionado (`item_frigobar.id`).
    pub iditem_frigobar: i64,
    pub quantidade: i32,
    pub valor_total: Decimal,
}

#[derive(Debug, Clone, Default)]
pub struct FiltroReserva {
    pub periodo: Option<PeriodoEstadia>,
    pub status: Option<StatusReserva>,
    pub idacomodacao: Option<i64>,
    pub idcliente: Option<i64>,
    /// Busca livre: nome/CPF do cliente, nome/número da acomodação
    /// ou nº da reserva (legado: select `filtro` + `buscafiltro`).
    pub busca: Option<String>,
}

#[async_trait]
pub trait ReservaRepository: Send + Sync {
    async fn buscar(&self, id: i64) -> Result<Option<Reserva>, DomainError>;
    async fn buscar_detalhe(&self, id: i64) -> Result<Option<ReservaDetalhe>, DomainError>;
    async fn listar(
        &self,
        filtro: &FiltroReserva,
        page: PageParams,
    ) -> Result<Page<ReservaResumo>, DomainError>;
    /// Eventos do calendário (todas as reservas que intersectam o período).
    async fn listar_eventos(
        &self,
        periodo: Option<PeriodoEstadia>,
    ) -> Result<Vec<ReservaResumo>, DomainError>;

    /// Acomodações sem reserva ocupante no período (legado: disponibilidade.php).
    /// `hospedes` reprecifica `valor` pela tarifa de ocupação do tipo
    /// (maior faixa <= N); `None` devolve o valor-base da acomodação.
    async fn disponibilidade(
        &self,
        periodo: PeriodoEstadia,
        hospedes: Option<i32>,
        idacomodacao: Option<i64>,
        excluir_reserva: Option<i64>,
    ) -> Result<Vec<AcomodacaoDisponivel>, DomainError>;

    /// Cria reserva + conta de consumo 'pendente' + log — uma transação.
    ///
    /// Overbooking é impossível por construção: a constraint de exclusão do
    /// Postgres (`daterange` + GiST) rejeita períodos sobrepostos com
    /// SQLSTATE 23P01, que a implementação traduz para `Conflito`.
    async fn criar(&self, nova: &NovaReserva, log: NovoLog) -> Result<Reserva, DomainError>;

    /// Mapa por andar — uma linha por acomodação ativa com ocupação de
    /// hoje, bloqueio vigente e pendências de limpeza/manutenção.
    async fn mapa_quartos(&self) -> Result<Vec<MapaQuarto>, DomainError>;
    /// Pendências operacionais do fechamento do dia.
    async fn pendencias_fechamento(
        &self,
    ) -> Result<crate::queries::PendenciasFechamento, DomainError>;

    /// Bloqueio formal — tira a unidade de toda disponibilidade.
    async fn bloqueio_criar(
        &self,
        idacomodacao: i64,
        inicio: NaiveDate,
        fim: NaiveDate,
        motivo: &str,
        criado_por: i64,
    ) -> Result<Bloqueio, DomainError>;
    async fn bloqueio_listar(&self) -> Result<Vec<Bloqueio>, DomainError>;
    async fn bloqueio_remover(&self, id: i64) -> Result<(), DomainError>;

    /// Grupo/evento — cria grupo + rooming list + (opcional) bloqueio por
    /// unidade numa transação; remover o grupo libera tudo em cascata.
    #[allow(clippy::too_many_arguments)]
    async fn grupo_criar(
        &self,
        nome: &str,
        contato: Option<&str>,
        obs: Option<&str>,
        inicio: NaiveDate,
        fim: NaiveDate,
        unidades: &[i64],
        bloquear: bool,
        criado_por: i64,
    ) -> Result<Grupo, DomainError>;
    async fn grupo_listar(&self) -> Result<Vec<Grupo>, DomainError>;
    async fn grupo_unidades(&self, idgrupo: i64) -> Result<Vec<GrupoUnidadeView>, DomainError>;
    async fn grupo_remover(&self, id: i64) -> Result<(), DomainError>;
    /// Vincula (`Some`) ou desvincula (`None`) uma reserva ao grupo.
    async fn reserva_vincular_grupo(
        &self,
        idreserva: i64,
        idgrupo: Option<i64>,
    ) -> Result<(), DomainError>;

    /// Check-in: trava a reserva `FOR UPDATE`, valida a transição
    /// `pendente → iniciada`, atribui o quarto físico livre e audita.
    async fn checkin(
        &self,
        id: i64,
        em: DateTime<Utc>,
        log: NovoLog,
    ) -> Result<Reserva, DomainError>;

    /// Check-out: valida `iniciada → finalizada`, grava adicionais, fecha a
    /// conta de consumo e audita — uma transação.
    async fn checkout(
        &self,
        cmd: &ComandoCheckout,
        em: DateTime<Utc>,
        log: NovoLog,
    ) -> Result<(Reserva, Consumo), DomainError>;

    /// Cancelamento: `pendente|iniciada → cancelada`; compensa o consumo
    /// ('cancelado' ou 'reembolsado' + lançamento em `reembolso`).
    async fn cancelar(
        &self,
        id: i64,
        motivo: Option<&str>,
        idfuncionario: Option<i64>,
        log: NovoLog,
    ) -> Result<ResultadoCancelamento, DomainError>;

    /// Baixa item do frigobar, registra 'saida' no estoque, insere em
    /// `item_consumido` e recalcula os totais do consumo — uma transação.
    async fn registrar_item_consumido(
        &self,
        novo: &NovoItemConsumido,
        idfuncionario: i64,
        log: NovoLog,
    ) -> Result<ItemConsumido, DomainError>;

    async fn listar_itens_consumidos(
        &self,
        idconsumo: i64,
    ) -> Result<Vec<ItemConsumido>, DomainError>;
    async fn listar_adicionais(&self, idconsumo: i64)
        -> Result<Vec<AdicionalConsumo>, DomainError>;
    /// Lançamento avulso na conta aberta durante a estadia
    /// (consumo adicional do legado) — insere e soma em `valor_adicional`.
    async fn lancar_adicional(
        &self,
        idconsumo: i64,
        adicional: &NovoAdicional,
        log: NovoLog,
    ) -> Result<AdicionalConsumo, DomainError>;
    async fn consumo_da_reserva(&self, idreserva: i64) -> Result<Option<Consumo>, DomainError>;

    /// Contagem de reservas por acomodação no período (gráfico do legado).
    async fn contar_por_acomodacao(
        &self,
        periodo: Option<PeriodoEstadia>,
    ) -> Result<Vec<(String, i64)>, DomainError>;

    /// Quantas diárias ocupadas no mês corrente por acomodação (ocupação).
    async fn ocupacao_mensal(&self, ano: i32, mes: u32) -> Result<Vec<(i64, i64)>, DomainError>;

    /// Comprovantes de pagamento de reservas finalizadas (tela Pagamentos).
    async fn comprovantes(&self) -> Result<Vec<ComprovanteResumo>, DomainError>;

    /// Exclui em definitivo uma reserva **pendente ou cancelada** junto com
    /// sua conta de consumo, itens, adicionais e reembolsos — uma transação.
    /// Reservas iniciadas/finalizadas não podem ser excluídas (histórico
    /// fiscal) — use Cancelar.
    async fn remover(&self, id: i64, log: NovoLog) -> Result<(), DomainError>;
}

// ---------------------------------------------------------------------------
// Acompanhantes — demais ocupantes da reserva com dados próprios
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct NovoAcompanhante {
    pub nome: String,
    pub data_nascimento: Option<NaiveDate>,
    pub parentesco: Option<String>,
    pub doc_tipo: Option<String>,
    pub doc_numero: Option<String>,
}

#[async_trait]
pub trait AcompanhanteRepository: Send + Sync {
    async fn listar(&self, idreserva: i64) -> Result<Vec<Acompanhante>, DomainError>;
    async fn criar(
        &self,
        idreserva: i64,
        novo: &NovoAcompanhante,
        log: NovoLog,
    ) -> Result<Acompanhante, DomainError>;
    async fn remover(&self, id: i64, log: NovoLog) -> Result<(), DomainError>;
}

// ---------------------------------------------------------------------------
// FNRH — arquivo digital das fichas emitidas
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct NovaFnrh {
    pub idreserva: i64,
    pub idcliente: i64,
    pub motivo_viagem: Option<String>,
    pub placa_veiculo: Option<String>,
    /// Snapshot imutável da ficha (cliente + reserva + acompanhantes + emissor).
    pub dados: JsonValue,
    pub emitida_por: Option<i64>,
}

#[async_trait]
pub trait FnrhRepository: Send + Sync {
    async fn emitir(&self, nova: &NovaFnrh, log: NovoLog) -> Result<Fnrh, DomainError>;
    /// Fichas da reserva, mais recente primeiro.
    async fn listar_por_reserva(&self, idreserva: i64) -> Result<Vec<Fnrh>, DomainError>;
    /// Arquivo digital do hóspede — todas as fichas já emitidas para ele.
    async fn listar_por_cliente(&self, idcliente: i64) -> Result<Vec<Fnrh>, DomainError>;
    /// Fichas emitidas no período — exportação SNE/CSV para envio manual.
    async fn listar_periodo(
        &self,
        inicio: chrono::NaiveDate,
        fim: chrono::NaiveDate,
    ) -> Result<Vec<Fnrh>, DomainError>;
}
