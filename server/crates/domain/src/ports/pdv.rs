//! Port do PDV & Comandas — vendas de salão/quarto/balcão.
//!
//! Invariantes centrais:
//! * uma mesa admite no máximo uma comanda aberta (índice parcial);
//! * lançar item debita `estoque.quantidade` e grava `movimento_estoque`
//!   'saida' na mesma transação — estoque nunca fica negativo;
//! * cancelar item devolve a quantidade ('entrada') — estorno auditável;
//! * fechar gera o espelho financeiro na mesma tx (lancamento + baixa ou
//!   lançamento em aberto p/ faturar no quarto) e provisiona a comissão;
//! * preço vem sempre do cadastro do item, nunca da requisição.

use crate::entities::{NovoLog, PdvComanda, PdvComandaItem, PdvComissao, PdvGarcom, PdvMesa};
use crate::enums::{PdvComandaStatus, PdvComandaTipo};
use crate::error::DomainError;
use crate::queries::{
    ComandaItemView, ComandaView, ComissaoResumo, ComissaoView, FilaItemView, GarcomView,
    ItemVendaView, MesaView,
};
use async_trait::async_trait;
use chrono::NaiveDate;
use clarituz_shared::{Page, PageParams};
use rust_decimal::Decimal;

/// Abertura de comanda.
#[derive(Debug, Clone)]
pub struct NovaComanda {
    pub tipo: PdvComandaTipo,
    pub idmesa: Option<i64>,
    pub idquarto: Option<i64>,
    pub idcliente: Option<i64>,
    pub idgarcom: Option<i64>,
    pub rotulo: Option<String>,
}

/// Item a lançar na comanda (preço resolvido na infra).
#[derive(Debug, Clone)]
pub struct NovoItemComanda {
    pub iditem: i64,
    pub quantidade: i32,
}

/// Modo de liquidação no fechamento.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModoFechamento {
    /// Pago na hora — gera lancamento + baixa quitada.
    Pagar,
    /// Faturar ao quarto — lancamento em aberto vinculado à reserva.
    Faturar,
}

/// Dados do fechamento de comanda.
#[derive(Debug, Clone)]
pub struct FechamentoComanda {
    pub modo: ModoFechamento,
    pub desconto: Decimal,
    /// Obrigatórios no modo `Pagar`.
    pub idconta_financeira: Option<i64>,
    pub idforma_pagamento: Option<i64>,
    pub observacao: Option<String>,
}

/// Filtro das comandas.
#[derive(Debug, Clone, Default)]
pub struct FiltroComanda {
    pub tipo: Option<PdvComandaTipo>,
    pub status: Option<PdvComandaStatus>,
    pub idgarcom: Option<i64>,
    pub inicio: Option<NaiveDate>,
    pub fim: Option<NaiveDate>,
}

/// Filtro do extrato de comissões.
#[derive(Debug, Clone, Default)]
pub struct FiltroComissao {
    pub idgarcom: Option<i64>,
    pub apenas_pendentes: bool,
    pub inicio: Option<NaiveDate>,
    pub fim: Option<NaiveDate>,
}

#[async_trait]
pub trait PdvRepository: Send + Sync {
    // -- mesas ---------------------------------------------------------------
    async fn listar_mesas(&self) -> Result<Vec<MesaView>, DomainError>;
    async fn criar_mesa(
        &self,
        numero: &str,
        lugares: i32,
        log: NovoLog,
    ) -> Result<PdvMesa, DomainError>;
    async fn status_mesa(&self, id: i64, ativo: bool, log: NovoLog)
        -> Result<PdvMesa, DomainError>;

    // -- garçons --------------------------------------------------------------
    async fn listar_garcons(&self) -> Result<Vec<GarcomView>, DomainError>;
    async fn salvar_garcom(
        &self,
        idfuncionario: i64,
        percentual: Decimal,
        ativo: bool,
        log: NovoLog,
    ) -> Result<PdvGarcom, DomainError>;

    // -- comandas -------------------------------------------------------------
    async fn listar_comandas(
        &self,
        filtro: &FiltroComanda,
        page: PageParams,
    ) -> Result<Page<ComandaView>, DomainError>;

    async fn buscar_comanda(&self, id: i64) -> Result<Option<ComandaView>, DomainError>;

    async fn listar_itens(&self, idcomanda: i64) -> Result<Vec<ComandaItemView>, DomainError>;

    /// Abre comanda — tx: valida mesa/quarto/reserva/garçom + auditoria.
    /// 409 se a mesa já tiver comanda aberta.
    async fn abrir_comanda(
        &self,
        nova: &NovaComanda,
        idfuncionario: i64,
        log: NovoLog,
    ) -> Result<PdvComanda, DomainError>;

    /// Lança item — tx única: trava a comanda (aberta), trava o estoque
    /// (`FOR UPDATE`), debita a quantidade, grava movimento 'saida',
    /// insere o item com preço real e recalcula o subtotal.
    async fn adicionar_item(
        &self,
        idcomanda: i64,
        item: &NovoItemComanda,
        idfuncionario: i64,
        log: NovoLog,
    ) -> Result<PdvComandaItem, DomainError>;

    /// Marca item entregue — comanda aberta + item pendente.
    async fn entregar_item(
        &self,
        idcomanda: i64,
        iditem_comanda: i64,
        log: NovoLog,
    ) -> Result<PdvComandaItem, DomainError>;

    /// Cancela item — tx única: devolve a quantidade ao estoque
    /// (movimento 'entrada' de estorno) e recalcula o subtotal.
    async fn cancelar_item(
        &self,
        idcomanda: i64,
        iditem_comanda: i64,
        motivo: Option<&str>,
        idfuncionario: i64,
        log: NovoLog,
    ) -> Result<PdvComandaItem, DomainError>;

    /// Cancela a comanda inteira — tx: estorna todos os itens não
    /// cancelados ao estoque e marca `cancelada`.
    async fn cancelar_comanda(
        &self,
        idcomanda: i64,
        motivo: Option<&str>,
        idfuncionario: i64,
        log: NovoLog,
    ) -> Result<PdvComanda, DomainError>;

    /// Fecha a comanda — tx única: trava a comanda, exige ≥1 item ativo,
    /// recalcula total = subtotal − desconto, cria o espelho financeiro
    /// (lancamento receber + baixa quando `Pagar`, aberto quando `Faturar`)
    /// e provisiona a comissão do garçom (se houver %).
    async fn fechar_comanda(
        &self,
        idcomanda: i64,
        fechamento: &FechamentoComanda,
        idfuncionario: i64,
        log: NovoLog,
    ) -> Result<PdvComanda, DomainError>;

    // -- itens vendáveis + comissões ------------------------------------------
    /// Itens de estoque ativos com saldo — picker do PDV.
    async fn listar_itens_venda(
        &self,
        busca: Option<&str>,
    ) -> Result<Vec<ItemVendaView>, DomainError>;

    async fn listar_comissoes(
        &self,
        filtro: &FiltroComissao,
        page: PageParams,
    ) -> Result<Page<ComissaoView>, DomainError>;

    /// Acumulado por garçom (pendente/pago) no período.
    async fn resumo_comissoes(
        &self,
        inicio: Option<NaiveDate>,
        fim: Option<NaiveDate>,
    ) -> Result<Vec<ComissaoResumo>, DomainError>;

    /// Paga uma comissão — tx: lançamento a pagar (plano 'Comissões de
    /// garçons') + baixa quitada na conta informada + status 'paga'.
    async fn pagar_comissao(
        &self,
        idcomissao: i64,
        idconta_financeira: i64,
        idforma_pagamento: Option<i64>,
        idfuncionario: i64,
        log: NovoLog,
    ) -> Result<PdvComissao, DomainError>;

    // ------------------------------------------------------------------ KDS
    /// Fila da cozinha — itens pendentes/em preparo/prontos de comandas
    /// abertas, mais antigos primeiro.
    async fn listar_fila_cozinha(&self) -> Result<Vec<FilaItemView>, DomainError>;

    /// pendente → em_preparo (cozinha iniciou o item).
    async fn iniciar_preparo(
        &self,
        idcomanda: i64,
        iditem_comanda: i64,
        log: NovoLog,
    ) -> Result<PdvComandaItem, DomainError>;

    /// em_preparo → pronto (item produzido, aguarda entrega).
    async fn marcar_pronto(
        &self,
        idcomanda: i64,
        iditem_comanda: i64,
        log: NovoLog,
    ) -> Result<PdvComandaItem, DomainError>;

    /// em_preparo/pronto → pendente (devolve à fila — erro do operador).
    async fn retornar_fila(
        &self,
        idcomanda: i64,
        iditem_comanda: i64,
        log: NovoLog,
    ) -> Result<PdvComandaItem, DomainError>;
}
