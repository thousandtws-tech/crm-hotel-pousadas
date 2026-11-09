//! Enums fortemente tipados do domínio.
//!
//! Os discriminantes de 1 caractere preservam compatibilidade semântica com o
//! legado (`status IN ('p','i','c','f')`), mas como enums nativos do Postgres.

use serde::{Deserialize, Serialize};

/// Ciclo de vida da reserva (legado: char `p`/`i`/`c`/`f`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "reserva_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum StatusReserva {
    /// Reserva criada, aguardando check-in.
    #[sqlx(rename = "p")]
    #[serde(rename = "p")]
    Pendente,
    /// Check-in realizado — hóspede na casa.
    #[sqlx(rename = "i")]
    #[serde(rename = "i")]
    Iniciada,
    /// Cancelada (libera a acomodação).
    #[sqlx(rename = "c")]
    #[serde(rename = "c")]
    Cancelada,
    /// Check-out realizado — ciclo encerrado.
    #[sqlx(rename = "f")]
    #[serde(rename = "f")]
    Finalizada,
}

impl StatusReserva {
    /// Status que ainda ocupam a acomodação (usado pela constraint de overlap).
    pub const OCUPANTES: &'static [Self] = &[Self::Pendente, Self::Iniciada];

    pub fn ocupa(&self) -> bool {
        matches!(self, Self::Pendente | Self::Iniciada)
    }

    pub fn permite_checkin(&self) -> bool {
        *self == Self::Pendente
    }

    pub fn permite_checkout(&self) -> bool {
        *self == Self::Iniciada
    }

    pub fn permite_cancelamento(&self) -> bool {
        matches!(self, Self::Pendente | Self::Iniciada)
    }
}

/// Ciclo de vida da conta de consumo vinculada a uma reserva.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "consumo_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum StatusConsumo {
    Pendente,
    Concluido,
    Cancelado,
    Reembolsado,
}

impl StatusConsumo {
    pub fn aberto(&self) -> bool {
        *self == Self::Pendente
    }
}

/// Direção da movimentação de estoque.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "tipo_movimento", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum TipoMovimento {
    Entrada,
    Saida,
}

/// Natureza do lançamento financeiro.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "lancamento_tipo", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum TipoLancamento {
    /// Conta a pagar (saída).
    Pagar,
    /// Conta a receber (entrada).
    Receber,
}

/// Ciclo de vida do título (contas a pagar/receber).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "lancamento_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum StatusLancamento {
    /// Em aberto — nenhuma baixa registrada.
    Aberto,
    /// Baixa parcial — ainda resta saldo.
    Parcial,
    /// Totalmente liquidado.
    Liquidado,
    /// Cancelado — não afeta caixa nem DRE.
    Cancelado,
}

impl StatusLancamento {
    /// Se ainda admite baixas (não está encerrado).
    pub fn liquido_aberto(&self) -> bool {
        matches!(self, Self::Aberto | Self::Parcial)
    }
}

/// Natureza da conta financeira (onde o dinheiro vive).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "conta_financeira_tipo", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum TipoContaFinanceira {
    /// Caixa físico (dinheiro na recepção).
    Caixa,
    /// Conta bancária — alvo da conciliação.
    Banco,
    /// Aplicação/reserva.
    Aplicacao,
}

/// Estado da linha de extrato no processo de conciliação.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "extrato_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum StatusExtrato {
    /// Importado, aguardando match.
    Pendente,
    /// Vinculado a uma baixa.
    Conciliado,
    /// Descartado da conciliação (ex.: lançamento sem contrapartida).
    Ignorado,
}

/// Ciclo do tributo segregado (split payment IBS/CBS).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "split_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum StatusSplit {
    /// Calculado, aguardando apuração.
    Provisionado,
    /// Segregado na conta de tributos.
    Segregado,
    /// Recolhido ao fisco (apuração do mês fechada).
    Recolhido,
}

/// Agrupador do DRE — determina o sinal da conta no resultado.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "dre_grupo", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum GrupoDre {
    /// Soma na receita bruta.
    ReceitaBruta,
    /// Subtrai da receita (descontos, tributos, devoluções).
    Deducoes,
    /// Subtrai após a receita líquida (CMV, comissões).
    Custos,
    /// Despesas operacionais (pessoal, utilidades, manutenção…).
    DespesasOperacionais,
    /// Juros, tarifas, rendimentos.
    ResultadoFinanceiro,
    /// Receitas/despesas não operacionais.
    Outras,
}

/// Estado do turno de caixa (gaveta física por operador).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "caixa_turno_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum StatusTurno {
    /// Turno em operação — admite movimentos.
    Aberto,
    /// Conferido e encerrado — quebra já calculada.
    Fechado,
}

/// Movimento avulso de dinheiro vivo dentro do turno.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "caixa_mov_tipo", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum TipoMovimentoCaixa {
    /// Retirada de dinheiro da gaveta (ex.: depósito, pagamento urgente).
    Sangria,
    /// Entrada de dinheiro para troco/reforço.
    Suprimento,
}

/// Nível de acesso do funcionário (legado: `nivel == 1` ⇒ administrador).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NivelAcesso {
    Administrador = 1,
    Gerente = 2,
    Recepcao = 3,
}

impl NivelAcesso {
    pub fn from_i16(v: i16) -> Self {
        match v {
            1 => Self::Administrador,
            2 => Self::Gerente,
            _ => Self::Recepcao,
        }
    }

    pub fn as_i16(self) -> i16 {
        self as i16
    }

    /// Administração irrestrita (funcionários, configurações, auditoria).
    pub fn is_admin(self) -> bool {
        self == Self::Administrador
    }

    /// Pode operar rotinas administrativas sensíveis (admin + gerente).
    pub fn is_gerencial(self) -> bool {
        self <= Self::Gerente
    }
}

// ---------------------------------------------------------------------------
// PDV & comandas
// ---------------------------------------------------------------------------

/// Origem da comanda — mesa do salão, quarto de hóspede ou balcão avulso.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "pdv_comanda_tipo", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum PdvComandaTipo {
    /// Mesa do salão — exige `idmesa`, uma comanda aberta por mesa.
    Mesa,
    /// Quarto de hóspede — exige `idquarto` (e reserva em estadia).
    Quarto,
    /// Venda avulsa de balcão — rótulo livre, sem mesa nem quarto.
    Balcao,
}

/// Estado da comanda.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "pdv_comanda_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum PdvComandaStatus {
    /// Em operação — admite itens e movimentos.
    Aberta,
    /// Encerrada — total e espelho financeiro já gerados.
    Fechada,
    /// Cancelada — itens estornados ao estoque.
    Cancelada,
}

/// Estado de um item lançado na comanda.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "pdv_item_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum PdvItemStatus {
    /// Lançado, na fila da cozinha.
    Pendente,
    /// Em preparo na cozinha.
    #[sqlx(rename = "em_preparo")]
    #[serde(rename = "em_preparo")]
    EmPreparo,
    /// Produzido — aguardando entrega pelo garçom/caixa.
    Pronto,
    /// Entregue ao cliente.
    Entregue,
    /// Cancelado — quantidade devolvida ao estoque.
    Cancelado,
}

/// Estado de pagamento da comissão do garçom.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "pdv_comissao_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum PdvComissaoStatus {
    /// Provisionada no fechamento, aguardando pagamento.
    Pendente,
    /// Paga — lançamento a pagar quitado.
    Paga,
}

/// Tipo da obrigação cobrada via Stripe (integral, sinal de 30% ou saldo).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "pagamento_tipo", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum TipoPagamento {
    Integral,
    Sinal,
    Saldo,
}

/// Ciclo de vida do pagamento online — dirigido pelos webhooks Stripe e
/// pelo sweeper de expiração. `Pago` é o único estado de liquidação.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "pagamento_status", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum StatusPagamento {
    /// Tentativa(s) em aberto ou aguardando confirmação assíncrona (Pix).
    Pendente,
    Pago,
    /// Todas as tentativas expiraram sem pagamento.
    Expirado,
    Falhou,
    Cancelado,
    ReembolsoParcial,
    Reembolsado,
}

impl StatusPagamento {
    /// Pode receber uma nova tentativa de checkout.
    pub fn cobravel(&self) -> bool {
        matches!(self, Self::Pendente | Self::Falhou | Self::Expirado)
    }

    /// Liquidação confirmada — não volta atrás exceto por reembolso.
    pub fn liquidado(&self) -> bool {
        matches!(
            self,
            Self::Pago | Self::ReembolsoParcial | Self::Reembolsado
        )
    }
}

/// Processamento do evento de webhook na inbox (`pagamento_webhook_evento`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "webhook_proc_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum StatusProcWebhook {
    Recebido,
    Processado,
    Falhou,
    /// Evento válido porém irrelevante para o domínio (ex.: evento desconhecido).
    Ignorado,
}

/// Estado do reembolso Stripe (`pagamento_reembolso`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "reembolso_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum StatusReembolso {
    Pendente,
    Concluido,
    Falhou,
}
