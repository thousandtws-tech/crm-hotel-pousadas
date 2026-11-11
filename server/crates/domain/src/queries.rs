//! Read models — projeções de consulta (joins, agregações, relatórios).
//! Separação CQRS-lite: entidades escrevem, estas structs respondem leituras.

use crate::enums::{
    GrupoDre, PdvComandaStatus, PdvComandaTipo, PdvComissaoStatus, PdvItemStatus, StatusConsumo,
    StatusExtrato, StatusLancamento, StatusReserva, StatusSplit, StatusTurno, TipoLancamento,
    TipoMovimento, TipoMovimentoCaixa,
};
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::Serialize;
use sqlx::FromRow;

/// Resumo de reserva para listagens e calendário.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ReservaResumo {
    pub id: i64,
    pub idacomodacao: i64,
    pub acomodacao_nome: String,
    pub acomodacao_numero: i32,
    pub acomodacao_cor: String,
    pub idcliente: i64,
    pub cliente_nome: String,
    pub quantidade_hospedes: i32,
    pub entradaprevista: NaiveDate,
    pub saidaprevista: NaiveDate,
    pub status: StatusReserva,
    pub valordiaria: Decimal,
    /// Quarto atribuído no check-in — usado pelo PDV (comanda de quarto).
    pub idquarto: Option<i64>,
    pub quarto_numero: Option<String>,
    pub valor_estadia: Option<Decimal>,
}

/// Detalhe completo da reserva (equivalente a `cDadosReserva.php`).
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ReservaDetalhe {
    pub id: i64,
    pub idacomodacao: i64,
    pub idcliente: i64,
    pub idquarto: Option<i64>,
    pub quarto_numero: Option<String>,
    pub quantidade_hospedes: i32,
    pub entradaprevista: NaiveDate,
    pub saidaprevista: NaiveDate,
    pub checkin_em: Option<DateTime<Utc>>,
    pub checkout_em: Option<DateTime<Utc>>,
    pub obs: Option<String>,
    pub status: StatusReserva,
    pub valordiaria: Decimal,
    pub criado_em: DateTime<Utc>,
    pub acomodacao_nome: String,
    pub acomodacao_numero: i32,
    pub acomodacao_valor: Decimal,
    pub cliente_nome: String,
    pub cliente_cpf: String,
    /// Prazo de pagamento da reserva online (NULL = recepção, sem hold).
    pub expira_em: Option<DateTime<Utc>>,
    /// Preenchido por segunda consulta — não vem do join principal.
    #[sqlx(skip)]
    pub consumo: Option<ConsumoResumo>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ConsumoResumo {
    pub id: i64,
    pub status: StatusConsumo,
    pub valor_estadia: Decimal,
    pub valor_itens: Decimal,
    pub valor_adicional: Decimal,
    pub total_desconto: Decimal,
    pub valor_final: Option<Decimal>,
    pub idforma_pagamento: Option<i64>,
    pub forma_pagamento: Option<String>,
    pub comprovante: Option<String>,
    pub fechado_em: Option<DateTime<Utc>>,
}

/// Acomodação livre no período (equivalente a `api/disponibilidade.php`).
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct AcomodacaoDisponivel {
    pub id: i64,
    pub nome: String,
    pub numero: i32,
    pub valor: Decimal,
    pub capacidade: i32,
}

/// Item do frigobar enriquecido com dados do estoque.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ItemFrigobarView {
    pub id: i64,
    pub idfrigobar: i64,
    pub iditem: i64,
    pub item_nome: String,
    pub valor_unitario: Decimal,
    pub quantidade: i32,
    pub ativo: bool,
}

/// Movimento de estoque enriquecido.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct MovimentoView {
    pub id: i64,
    pub iditem: i64,
    pub item_nome: String,
    pub tipo: TipoMovimento,
    pub quantidade: i32,
    pub funcionario: Option<String>,
    pub motivo: String,
    pub criado_em: DateTime<Utc>,
}

/// Cards do dashboard (equivalente a `home/include/dadosCard.php`).
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct DashboardCards {
    pub total_acomodacoes: i64,
    pub acomodacoes_disponiveis: i64,
    pub acomodacoes_ocupadas: i64,
    pub hospedes_atuais: i64,
    pub checkins_hoje: i64,
    pub checkouts_hoje: i64,
    pub checkins_pendentes_hoje: i64,
    pub checkouts_pendentes_hoje: i64,
}

/// Resumo financeiro de um período (equivalente a `financeiro/include/valores.php`).
#[derive(Debug, Clone, Serialize)]
pub struct ResumoFinanceiro {
    /// Fechado (consumos concluídos) no período.
    pub recebido: Decimal,
    pub recebido_estadias: Decimal,
    pub recebido_itens: Decimal,
    pub recebido_adicionais: Decimal,
    /// A receber: reservas não canceladas/finalizadas com saída no período.
    pub previsto: Decimal,
    pub descontos: Decimal,
    pub qtd_contas_fechadas: i64,
}

/// Ponto de série temporal para gráficos.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct PontoSerie {
    pub rotulo: String,
    pub valor: Decimal,
    pub quantidade: i64,
}

/// Ranking de item vendido no período (gráfico "Itens mais vendidos").
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ItemMaisVendido {
    pub nome: String,
    pub quantidade: i64,
    pub valor: Decimal,
}

/// Linha da tabela "Vendas" do financeiro (equivalente a `cFinanceiroVendas`).
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct VendaItem {
    pub idreserva: i64,
    pub item: String,
    pub quantidade: i32,
    pub valor_total: Decimal,
    pub criado_em: DateTime<Utc>,
}

/// Linha da tabela "Comprovantes de pagamento" do legado.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ComprovanteResumo {
    pub comprovante: String,
    pub idreserva: i64,
    pub cliente: String,
    pub acomodacao: String,
}

/// Check-in/check-out pendente de hoje (home).
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct PendenciaDia {
    pub idreserva: i64,
    pub acomodacao_nome: String,
    pub cliente_nome: String,
    pub entradaprevista: NaiveDate,
    pub saidaprevista: NaiveDate,
}

// ---------------------------------------------------------------------------
// financeiro / tesouraria
// ---------------------------------------------------------------------------

/// Lançamento enriquecido para listagem (joins de apresentação).
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct LancamentoView {
    pub id: i64,
    pub tipo: TipoLancamento,
    pub descricao: String,
    pub idplano_conta: Option<i64>,
    pub plano_conta: Option<String>,
    pub grupo_dre: Option<GrupoDre>,
    pub idconta_financeira: Option<i64>,
    pub conta_financeira: Option<String>,
    pub favorecido: Option<String>,
    pub documento: Option<String>,
    pub idcliente: Option<i64>,
    pub cliente_nome: Option<String>,
    pub idreserva: Option<i64>,
    pub valor: Decimal,
    pub valor_liquidado: Decimal,
    /// Derivado no SQL: valor - valor_liquidado.
    pub saldo: Decimal,
    pub emissao: NaiveDate,
    pub vencimento: NaiveDate,
    pub competencia: Option<NaiveDate>,
    pub status: StatusLancamento,
    /// Derivado: aberto/parcial com vencimento < hoje.
    pub vencido: bool,
    pub observacao: Option<String>,
    pub version: i64,
    pub criado_em: DateTime<Utc>,
}

/// Baixa enriquecida (conta, forma de pagamento, funcionário).
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct BaixaView {
    pub id: i64,
    pub idlancamento: i64,
    pub idconta_financeira: i64,
    pub conta_financeira: Option<String>,
    pub valor: Decimal,
    pub data: NaiveDate,
    pub idforma_pagamento: Option<i64>,
    pub forma_pagamento: Option<String>,
    pub observacao: Option<String>,
    pub funcionario: Option<String>,
    pub criado_em: DateTime<Utc>,
}

/// Linha do fluxo de caixa diário — regime de caixa + projeção.
#[derive(Debug, Clone, Serialize)]
pub struct FluxoCaixaDia {
    pub data: NaiveDate,
    /// Entradas realizadas (baixas de receber + consumos fechados).
    pub entradas: Decimal,
    /// Saídas realizadas (baixas de pagar).
    pub saidas: Decimal,
    /// entradas - saidas do dia.
    pub saldo: Decimal,
    /// Saldo acumulado desde o saldo inicial.
    pub acumulado: Decimal,
    /// A receber previsto para o dia (vencimentos em aberto).
    pub prev_entradas: Decimal,
    /// A pagar previsto para o dia.
    pub prev_saidas: Decimal,
}

/// Resposta do fluxo de caixa: saldo de abertura + série diária + totais.
#[derive(Debug, Clone, Serialize)]
pub struct FluxoCaixa {
    pub inicio: NaiveDate,
    pub fim: NaiveDate,
    /// Saldo disponível na véspera do período (saldo_inicial + caixa realizado).
    pub saldo_abertura: Decimal,
    pub total_entradas: Decimal,
    pub total_saidas: Decimal,
    /// Saldo projetado ao fim (abertura + realizado + previstos).
    pub saldo_final_previsto: Decimal,
    pub dias: Vec<FluxoCaixaDia>,
}

/// Linha do DRE — uma conta do plano (ou origem operacional) e seu total.
#[derive(Debug, Clone, Serialize)]
pub struct DreLinha {
    /// 'operacional' = gerado por consumos de reserva; id da conta caso contrário.
    pub origem: String,
    pub codigo: Option<String>,
    pub rotulo: String,
    pub grupo: GrupoDre,
    pub valor: Decimal,
}

/// DRE do período — regime de competência (campo `competencia`).
#[derive(Debug, Clone, Serialize)]
pub struct Dre {
    pub inicio: NaiveDate,
    pub fim: NaiveDate,
    pub receita_bruta: Decimal,
    /// Descontos de consumo + IBS/CBS provisionado + contas de dedução.
    pub deducoes: Decimal,
    pub receita_liquida: Decimal,
    pub custos: Decimal,
    pub despesas_operacionais: Decimal,
    pub lucro_operacional: Decimal,
    /// Saldo de receitas − despesas financeiras.
    pub resultado_financeiro: Decimal,
    /// Saldo de outras receitas − despesas não operacionais.
    pub outras: Decimal,
    pub resultado_liquido: Decimal,
    /// Tributos segregados (referência — já dentro de deduções).
    pub ibs: Decimal,
    pub cbs: Decimal,
    pub linhas: Vec<DreLinha>,
}

/// Extrato enriquecido com o estado da conciliação.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ExtratoView {
    pub id: i64,
    pub idconta_financeira: i64,
    pub conta_financeira: Option<String>,
    pub data: NaiveDate,
    pub descricao: String,
    pub documento: Option<String>,
    pub valor: Decimal,
    pub fit_id: Option<String>,
    pub origem: String,
    pub status: StatusExtrato,
    pub idbaixa: Option<i64>,
    /// Score do melhor candidato pendente (pré-calculado na listagem).
    pub melhor_score: Option<Decimal>,
    pub importado_em: DateTime<Utc>,
}

/// Candidato a match para conciliação manual.
#[derive(Debug, Clone, Serialize)]
pub struct SugestaoConciliacao {
    pub baixa: BaixaView,
    /// 0–100 — decai com distância de dias e divergência de descrição.
    pub score: Decimal,
    pub dias_diferenca: i64,
    /// Lançamento de origem (descrição + tipo) para conferência visual.
    pub lancamento_descricao: String,
    pub lancamento_tipo: TipoLancamento,
}

/// Linha de extrato pronta para gerar lançamento + baixa + conciliação.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ConciliacaoResumo {
    pub pendentes: i64,
    pub conciliados: i64,
    pub ignorados: i64,
    /// Último dia importado por conta (referência de cobertura).
    pub coberto_ate: Option<NaiveDate>,
}

/// Evento de split enriquecido com a descrição da origem.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct SplitEventoView {
    pub id: i64,
    pub origem: String,
    pub idorigem: i64,
    /// Descrição amigável (reserva/lancamento) para a UI.
    pub descricao: String,
    pub base: Decimal,
    pub aliq_ibs: Decimal,
    pub aliq_cbs: Decimal,
    pub valor_ibs: Decimal,
    pub valor_cbs: Decimal,
    pub valor_liquido: Decimal,
    pub competencia: NaiveDate,
    pub status: StatusSplit,
    pub criado_em: DateTime<Utc>,
}

/// Totais de split no período.
#[derive(Debug, Clone, Serialize)]
pub struct SplitResumo {
    pub inicio: NaiveDate,
    pub fim: NaiveDate,
    pub base: Decimal,
    pub valor_ibs: Decimal,
    pub valor_cbs: Decimal,
    pub valor_liquido: Decimal,
    pub qtd_eventos: i64,
    /// Provisionado ainda não recolhido (saldo na conta de tributos).
    pub provisionado_ibs: Decimal,
    pub provisionado_cbs: Decimal,
}

// ---------------------------------------------------------------------------
// controle de caixa (turnos de gaveta)
// ---------------------------------------------------------------------------

/// Turno enriquecido para listagens — operador, gaveta e totais de movimento.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct TurnoView {
    pub id: i64,
    pub idconta_financeira: i64,
    pub conta_financeira: String,
    pub idoperador: i64,
    pub operador: String,
    pub saldo_inicial: Decimal,
    pub aberto_em: DateTime<Utc>,
    pub fechado_em: Option<DateTime<Utc>>,
    pub valor_contado: Option<Decimal>,
    pub valor_esperado: Option<Decimal>,
    /// contado − esperado (negativo = falta; só existe após o fechamento).
    pub quebra: Option<Decimal>,
    pub status: StatusTurno,
    pub observacao: Option<String>,
    /// Totais de movimentos avulsos já registrados no turno.
    pub total_suprimentos: Decimal,
    pub total_sangrias: Decimal,
    pub version: i64,
    pub criado_em: DateTime<Utc>,
}

/// Movimento avulso (sangria/suprimento) com o nome de quem registrou.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct MovimentoCaixaView {
    pub id: i64,
    pub idturno: i64,
    pub tipo: TipoMovimentoCaixa,
    pub valor: Decimal,
    pub motivo: String,
    pub funcionario: String,
    pub criado_em: DateTime<Utc>,
}

/// Linha do detalhamento da conferência — cada evento que entra no esperado.
#[derive(Debug, Clone, Serialize)]
pub struct ConferenciaLinha {
    pub origem: String,
    pub descricao: String,
    pub valor: Decimal,
    /// +1 entra na gaveta, −1 sai.
    pub sinal: i32,
    pub criado_em: DateTime<Utc>,
}

/// Conferência automática do turno: o esperado é derivado do ledger
/// (fundo + suprimentos − sangrias + recebimentos − pagamentos + espécie).
#[derive(Debug, Clone, Serialize)]
pub struct ConferenciaCaixa {
    pub turno: TurnoView,
    pub fundo: Decimal,
    pub suprimentos: Decimal,
    pub sangrias: Decimal,
    /// Baixas a receber na conta do turno durante a janela.
    pub recebimentos: Decimal,
    /// Baixas a pagar na conta do turno durante a janela.
    pub pagamentos: Decimal,
    /// Consumos concluídos pagos em espécie (forma marcada `especie`).
    pub especie: Decimal,
    /// inicial + suprimentos − sangrias + recebimentos − pagamentos + espécie.
    pub esperado: Decimal,
    pub movimentos: Vec<MovimentoCaixaView>,
    /// Detalhe de cada lançamento que compõe o esperado.
    pub linhas: Vec<ConferenciaLinha>,
}

// ---------------------------------------------------------------------------
// PDV & comandas
// ---------------------------------------------------------------------------

/// Mesa com o estado da comanda aberta (se houver) — grade do salão.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct MesaView {
    pub id: i64,
    pub numero: String,
    pub lugares: i32,
    pub ativo: bool,
    /// Comanda aberta na mesa (None = mesa livre).
    pub idcomanda: Option<i64>,
    pub total_aberto: Option<Decimal>,
    pub garcom_nome: Option<String>,
}

/// Comanda enriquecida para listagens e painel de operação.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ComandaView {
    pub id: i64,
    pub tipo: PdvComandaTipo,
    pub idmesa: Option<i64>,
    pub mesa_numero: Option<String>,
    pub idquarto: Option<i64>,
    pub quarto_numero: Option<String>,
    pub idreserva: Option<i64>,
    pub idcliente: Option<i64>,
    pub cliente_nome: Option<String>,
    pub idgarcom: Option<i64>,
    pub garcom_nome: Option<String>,
    pub rotulo: Option<String>,
    pub status: PdvComandaStatus,
    /// Soma dos itens não cancelados (sempre recalculada na query).
    pub total_itens: Decimal,
    pub itens_pendentes: i64,
    pub desconto: Decimal,
    pub total: Decimal,
    pub idlancamento: Option<i64>,
    pub aberto_em: DateTime<Utc>,
    pub fechado_em: Option<DateTime<Utc>>,
    pub version: i64,
}

/// Item da comanda com nome/categoria do estoque.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ComandaItemView {
    pub id: i64,
    pub idcomanda: i64,
    pub iditem: i64,
    pub item_nome: String,
    pub categoria_nome: Option<String>,
    pub quantidade: i32,
    pub valor_unit: Decimal,
    pub valor_total: Decimal,
    pub status: PdvItemStatus,
    pub lancado_por: Option<i64>,
    pub lancado_por_nome: Option<String>,
    pub cancelado_por_nome: Option<String>,
    pub motivo_cancelamento: Option<String>,
    pub criado_em: DateTime<Utc>,
}

/// Item vendável no PDV — estoque ativo com quantidade disponível.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ItemVendaView {
    pub id: i64,
    pub nome: String,
    pub categoria_nome: Option<String>,
    pub quantidade: i32,
    pub valor_unitario: Decimal,
}

/// Garçom cadastrado com dados do funcionário.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct GarcomView {
    pub id: i64,
    pub idfuncionario: i64,
    pub funcionario_nome: String,
    pub percentual: Decimal,
    pub ativo: bool,
}

/// Comissão com contexto da comanda — extrato por garçom.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ComissaoView {
    pub id: i64,
    pub idgarcom: i64,
    pub garcom_nome: String,
    pub idcomanda: i64,
    pub comanda_descricao: String,
    pub percentual: Decimal,
    pub base: Decimal,
    pub valor: Decimal,
    pub status: PdvComissaoStatus,
    pub pago_em: Option<DateTime<Utc>>,
    pub criado_em: DateTime<Utc>,
}

/// Acumulado de comissões por garçom — pendente vs. pago.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ComissaoResumo {
    pub idgarcom: i64,
    pub garcom_nome: String,
    pub comissoes_pendentes: i64,
    pub valor_pendente: Decimal,
    pub valor_pago: Decimal,
}

/// Item na fila da cozinha (KDS) — comanda + contexto de destino.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct FilaItemView {
    pub id: i64,
    pub idcomanda: i64,
    pub comanda_tipo: PdvComandaTipo,
    pub mesa_numero: Option<String>,
    pub quarto_numero: Option<String>,
    pub rotulo: Option<String>,
    pub cliente_nome: Option<String>,
    pub garcom_nome: Option<String>,
    pub iditem: i64,
    pub item_nome: String,
    pub categoria_nome: Option<String>,
    pub quantidade: i32,
    pub status: PdvItemStatus,
    pub criado_em: DateTime<Utc>,
    pub comanda_aberto_em: DateTime<Utc>,
}

// ---------------------------------------------------------------------------
// Café da manhã — presença por reserva/dia
// ---------------------------------------------------------------------------

/// Linha do quadro diário — reserva em estadia + presença já marcada.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct CafeQuadroItem {
    pub idreserva: i64,
    pub cliente_nome: String,
    pub quantidade_hospedes: i32,
    pub quarto_numero: Option<String>,
    pub acomodacao_nome: String,
    pub entradaprevista: NaiveDate,
    pub saidaprevista: NaiveDate,
    pub presenca_id: Option<i64>,
    pub presenca_quantidade: Option<i32>,
    pub presenca_em: Option<DateTime<Utc>>,
    pub registrado_por_nome: Option<String>,
}

/// Presença com contexto — extrato do período.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct PresencaView {
    pub id: i64,
    pub idreserva: i64,
    pub data: NaiveDate,
    pub quantidade: i32,
    pub cliente_nome: String,
    pub quarto_numero: Option<String>,
    pub registrado_por_nome: Option<String>,
    pub criado_em: DateTime<Utc>,
}

/// Item da ficha técnica de um produto vendável (estoque → insumos).
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct FichaItemView {
    pub id: i64,
    pub idinsumo: i64,
    pub insumo: String,
    pub unidade: String,
    pub quantidade: i32,
    pub custo_unit: rust_decimal::Decimal,
}

/// Alerta de estoque mínimo: item ativo com quantidade <= estoque_minimo.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct EstoqueBaixoView {
    pub id: i64,
    pub nome: String,
    pub unidade: String,
    pub quantidade: i32,
    pub estoque_minimo: i32,
}

/// Pedido de compra com fornecedor e progresso de recebimento.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct PedidoCompraView {
    pub id: i64,
    pub idfornecedor: i64,
    pub fornecedor: String,
    pub fornecedor_cnpj: Option<String>,
    pub data_prevista: chrono::NaiveDate,
    pub valor_total: rust_decimal::Decimal,
    pub status: String,
    pub origem: String,
    pub idlancamento: Option<i64>,
    pub criado_por: Option<String>,
    pub observacao: Option<String>,
    pub total_itens: i64,
    pub recebido_itens: i64,
    pub criado_em: DateTime<Utc>,
}

/// Item do pedido de compra com nome do item de estoque.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct PedidoItemView {
    pub id: i64,
    pub iditem: i64,
    pub item: String,
    pub unidade: String,
    pub quantidade: i32,
    pub quantidade_recebida: i32,
    pub valor_unit: rust_decimal::Decimal,
}

/// Card do mapa por andar — uma linha por acomodação física, com
/// ocupação (reserva), bloqueio formal e pendências de operação.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct MapaQuarto {
    pub id: i64,
    pub nome: String,
    pub numero: i32,
    pub andar: i32,
    pub cor: String,
    pub tipo: Option<String>,
    /// Reserva ativa cobrindo hoje (p=pendente, i=iniciada).
    pub idreserva_hoje: Option<i64>,
    pub status_hoje: Option<String>,
    pub bloqueado: bool,
    /// Tarefas de limpeza de hoje não concluídas nos quartos vinculados.
    pub limpeza_pendente: i64,
    /// OS de manutenção abertas nos quartos vinculados.
    pub manut_aberta: i64,
}
