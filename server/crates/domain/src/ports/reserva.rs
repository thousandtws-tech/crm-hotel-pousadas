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

/// Preço de uma noite já resolvido para uma acomodação (grade do mapa).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, sqlx::FromRow)]
pub struct PrecoDia {
    pub idacomodacao: i64,
    pub dia: chrono::NaiveDate,
    pub valor: Decimal,
}
use async_trait::async_trait;
use chrono::{DateTime, NaiveDate, Utc};
use clarituz_shared::{Page, PageParams};
use rust_decimal::Decimal;
use serde_json::Value as JsonValue;
use std::sync::Arc;

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

    /// Total da estadia por acomodação — soma noite a noite resolvendo
    /// tarifa_periodo > tarifa_ocupacao > acomodacao.valor. Usado pela
    /// busca pública e pela criação de reservas (uma consulta por período
    /// cobre todas as unidades de uma vez).
    async fn precos_estadia(
        &self,
        periodo: PeriodoEstadia,
        hospedes: i32,
        idacomodacoes: &[i64],
    ) -> Result<std::collections::HashMap<i64, Decimal>, DomainError>;

    /// Preço resolvido por dia e por acomodação (grade do tape chart) —
    /// mesma precedência do `precos_estadia`, sem somar.
    async fn precos_diarios(
        &self,
        periodo: PeriodoEstadia,
        hospedes: i32,
        idacomodacoes: &[i64],
    ) -> Result<Vec<PrecoDia>, DomainError>;

    /// Cria reserva + conta de consumo 'pendente' + log — uma transação.
    ///
    /// Overbooking é impossível por construção: a constraint de exclusão do
    /// Postgres (`daterange` + GiST) rejeita períodos sobrepostos com
    /// SQLSTATE 23P01, que a implementação traduz para `Conflito`.
    async fn criar(&self, nova: &NovaReserva, log: NovoLog) -> Result<Reserva, DomainError>;
    /// Move a reserva para outra acomodação/período (drag no mapa de
    /// ocupação). `WHERE status = 'p'` — nada retornado significa check-in
    /// ou cancelamento concorrente → `Conflito`; o constraint
    /// `reserva_excl_overlap` continua valendo no UPDATE (23P01 →
    /// `Conflito`). Atualiza `consumo.valor_estadia` na mesma transação.
    async fn remanejar(
        &self,
        id: i64,
        idacomodacao: i64,
        periodo: &PeriodoEstadia,
        valor_total: Decimal,
        log: NovoLog,
    ) -> Result<Reserva, DomainError>;

    /// Resolve token público opaco → idreserva (portal/upsell).
    async fn reserva_por_token(&self, token: uuid::Uuid) -> Result<Option<i64>, DomainError>;

    /// Aplica o efeito de um pagamento `tipo = 'extra'` liquidado:
    /// flags early/late ou troca de acomodação (upgrade) + a receita no
    /// `consumo` — tudo numa transação. `contexto` traz `oferta` e, para
    /// upgrade, `idacomodacao`. Idempotente: flags já ligadas e mesmo
    /// destino de upgrade são no-op; a exclusão `reserva_excl_overlap`
    /// segue valendo na troca de unidade (23P01 → `Conflito`).
    async fn aplicar_extra(
        &self,
        idreserva: i64,
        contexto: &serde_json::Value,
        valor_centavos: i64,
        log: NovoLog,
    ) -> Result<(), DomainError>;

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
    async fn buscar(&self, id: i64) -> Result<Option<Fnrh>, DomainError>;
    /// Registra uma tentativa de transmissão (status 'pendente').
    async fn transmissao_registrar(
        &self,
        idfnrh: i64,
        idreserva: i64,
    ) -> Result<FnrhTransmissao, DomainError>;
    /// Resultado da tentativa — 'transmitida' (com protocolo) ou 'erro'.
    async fn transmissao_marcar(
        &self,
        id: i64,
        status: &str,
        protocolo: Option<&str>,
        erro: Option<&str>,
    ) -> Result<FnrhTransmissao, DomainError>;
    async fn transmissao_buscar(&self, id: i64) -> Result<Option<FnrhTransmissao>, DomainError>;
    /// Painel de transmissões — join com hóspede/acomodação da reserva.
    async fn transmissoes(
        &self,
        inicio: chrono::NaiveDate,
        fim: chrono::NaiveDate,
        status: Option<&str>,
    ) -> Result<Vec<FnrhTransmissaoView>, DomainError>;
}

// ---------------------------------------------------------------------------
// Transmissão SERPRO — a ficha oficial vai ao governo após a conferência
// da recepção; cada envio/retry fica registrado com protocolo e erro.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize)]
pub struct FnrhTransmissao {
    pub id: i64,
    pub idfnrh: i64,
    pub idreserva: i64,
    /// 'pendente' | 'transmitida' | 'erro'.
    pub status: String,
    /// Protocolo devolvido pelo SERPRO quando aceita.
    pub protocolo: Option<String>,
    pub erro: Option<String>,
    pub tentativas: i32,
    pub criado_em: DateTime<Utc>,
    pub transmitida_em: Option<DateTime<Utc>>,
}

/// Linha do painel — transmissão + contexto da reserva.
#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize)]
pub struct FnrhTransmissaoView {
    #[sqlx(flatten)]
    #[serde(flatten)]
    pub tx: FnrhTransmissao,
    pub hospede: String,
    pub acomodacao: Option<String>,
}

/// Retorno do provedor SERPRO.
pub struct FnrhSerproRetorno {
    pub protocolo: Option<String>,
    pub mensagem: Option<String>,
}

/// Port de submissão — implementado pelo adapter SERPRO em infra.
/// `None` no service = transmissões ficam 'pendente' até configurar.
#[async_trait]
pub trait ProvedorFnrh: Send + Sync {
    async fn transmitir(
        &self,
        ficha: &Fnrh,
        estabelecimento: &JsonValue,
    ) -> Result<FnrhSerproRetorno, DomainError>;

    /// Prova de credencial sem efeito colateral — usada pelo botão
    /// "Testar conexão" do módulo de Integrações.
    async fn testar(&self) -> Result<String, DomainError>;
}

/// Resolve o provedor FNRH por ambiente — credenciais do cofre de
/// integrações (módulo Integrações), com fallback às envs legadas.
#[async_trait]
pub trait FnrhResolver: Send + Sync {
    /// Adapter para transmissões reais — só quando a integração de
    /// produção está habilitada; senão tenta o fallback de ambiente.
    async fn provedor(&self) -> Result<Option<Arc<dyn ProvedorFnrh>>, DomainError>;
    /// Prova de credenciais para o botão "Testar conexão" — ignora
    /// `habilitado` (o teste é o portão da habilitação). `None` = sem
    /// credenciais configuradas no ambiente.
    async fn testar(
        &self,
        ambiente: crate::entities::AmbienteIntegracao,
    ) -> Result<Option<String>, DomainError>;
}
