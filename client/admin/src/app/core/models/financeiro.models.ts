// Contratos do domínio financeiro (extraído de api.models.ts).

export type TipoLancamento = 'pagar' | 'receber';
export type StatusLancamento = 'aberto' | 'parcial' | 'liquidado' | 'cancelado';
export type TipoContaFinanceira = 'caixa' | 'banco' | 'aplicacao';
export type StatusExtrato = 'pendente' | 'conciliado' | 'ignorado';
export type StatusSplit = 'provisionado' | 'segregado' | 'recolhido';
export type GrupoDre =
  | 'receita_bruta'
  | 'deducoes'
  | 'custos'
  | 'despesas_operacionais'
  | 'resultado_financeiro'
  | 'outras';

export interface PlanoConta {
  id: number;
  codigo: string;
  nome: string;
  tipo: TipoLancamento;
  grupo_dre: GrupoDre;
  ativo: boolean;
  sistema: boolean;
  version: number;
  criado_em: string;
  atualizado_em: string;
}

export interface ContaFinanceira {
  id: number;
  nome: string;
  tipo: TipoContaFinanceira;
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  saldo_inicial: string;
  saldo_inicial_em: string;
  ativo: boolean;
  version: number;
  criado_em: string;
  atualizado_em: string;
}

export interface Lancamento {
  id: number;
  tipo: TipoLancamento;
  descricao: string;
  idplano_conta: number | null;
  idconta_financeira: number | null;
  favorecido: string | null;
  documento: string | null;
  idcliente: number | null;
  idreserva: number | null;
  valor: string;
  valor_liquidado: string;
  emissao: string;
  vencimento: string;
  competencia: string | null;
  status: StatusLancamento;
  observacao: string | null;
  idfuncionario: number | null;
  version: number;
  criado_em: string;
  atualizado_em: string;
}

export interface LancamentoView {
  id: number;
  tipo: TipoLancamento;
  descricao: string;
  idplano_conta: number | null;
  plano_conta: string | null;
  grupo_dre: GrupoDre | null;
  idconta_financeira: number | null;
  conta_financeira: string | null;
  favorecido: string | null;
  documento: string | null;
  idcliente: number | null;
  cliente_nome: string | null;
  idreserva: number | null;
  valor: string;
  valor_liquidado: string;
  saldo: string;
  emissao: string;
  vencimento: string;
  competencia: string | null;
  status: StatusLancamento;
  vencido: boolean;
  observacao: string | null;
  version: number;
  criado_em: string;
}

export interface BaixaLancamento {
  id: number;
  idlancamento: number;
  idconta_financeira: number;
  valor: string;
  data: string;
  idforma_pagamento: number | null;
  observacao: string | null;
  idfuncionario: number | null;
  criado_em: string;
}

export interface BaixaView {
  id: number;
  idlancamento: number;
  idconta_financeira: number;
  conta_financeira: string | null;
  valor: string;
  data: string;
  idforma_pagamento: number | null;
  forma_pagamento: string | null;
  observacao: string | null;
  funcionario: string | null;
  criado_em: string;
}

export interface FluxoCaixaDia {
  data: string;
  entradas: string;
  saidas: string;
  saldo: string;
  acumulado: string;
  prev_entradas: string;
  prev_saidas: string;
}

export interface FluxoCaixa {
  inicio: string;
  fim: string;
  saldo_abertura: string;
  total_entradas: string;
  total_saidas: string;
  saldo_final_previsto: string;
  dias: FluxoCaixaDia[];
}

export interface DreLinha {
  origem: string;
  codigo: string | null;
  rotulo: string;
  grupo: GrupoDre;
  valor: string;
}

export interface Dre {
  inicio: string;
  fim: string;
  receita_bruta: string;
  deducoes: string;
  receita_liquida: string;
  custos: string;
  despesas_operacionais: string;
  lucro_operacional: string;
  resultado_financeiro: string;
  outras: string;
  resultado_liquido: string;
  ibs: string;
  cbs: string;
  linhas: DreLinha[];
}

export interface ExtratoView {
  id: number;
  idconta_financeira: number;
  conta_financeira: string | null;
  data: string;
  descricao: string;
  documento: string | null;
  valor: string;
  fit_id: string | null;
  origem: string;
  status: StatusExtrato;
  idbaixa: number | null;
  melhor_score: string | null;
  importado_em: string;
}

export interface ConciliacaoResumo {
  pendentes: number;
  conciliados: number;
  ignorados: number;
  coberto_ate: string | null;
}

export interface Conciliacao {
  id: number;
  idextrato_item: number;
  idbaixa: number;
  score: string;
  tipo: string;
  idfuncionario: number | null;
  criado_em: string;
}

export interface SugestaoConciliacao {
  baixa: BaixaView;
  score: string;
  dias_diferenca: number;
  lancamento_descricao: string;
  lancamento_tipo: TipoLancamento;
}

export interface SplitResumo {
  inicio: string;
  fim: string;
  base: string;
  valor_ibs: string;
  valor_cbs: string;
  valor_liquido: string;
  qtd_eventos: number;
  provisionado_ibs: string;
  provisionado_cbs: string;
}

export interface SplitEventoView {
  id: number;
  origem: string;
  idorigem: number;
  descricao: string | null;
  base: string;
  aliq_ibs: string;
  aliq_cbs: string;
  valor_ibs: string;
  valor_cbs: string;
  valor_liquido: string;
  competencia: string;
  status: StatusSplit;
  criado_em: string;
}

export interface TributoConfig {
  id: number;
  aliq_ibs: string;
  aliq_cbs: string;
  regime: string;
  vigente_desde: string;
  idfuncionario: number | null;
  criado_em: string;
}

export interface TributoApuracao {
  id: number;
  competencia: string;
  valor_ibs: string;
  valor_cbs: string;
  status: string;
  recolhido_em: string | null;
  idfuncionario: number | null;
  criado_em: string;
}

// inputs

export interface LancamentoInput {
  tipo: TipoLancamento;
  descricao: string;
  idplano_conta?: number | null;
  idconta_financeira?: number | null;
  favorecido?: string | null;
  documento?: string | null;
  idcliente?: number | null;
  idreserva?: number | null;
  valor: number;
  parcelas?: number | null;
  emissao?: string | null;
  vencimento: string;
  competencia?: string | null;
  observacao?: string | null;
  version?: number;
}

export interface BaixaInput {
  idconta_financeira: number;
  valor: number;
  data?: string | null;
  idforma_pagamento?: number | null;
  observacao?: string | null;
}

export interface ContaFinanceiraInput {
  nome: string;
  tipo: TipoContaFinanceira;
  banco?: string | null;
  agencia?: string | null;
  conta?: string | null;
  saldo_inicial?: number | null;
  saldo_inicial_em?: string | null;
  version?: number;
}

export interface BaixaResponse {
  baixa: BaixaLancamento;
  lancamento: Lancamento;
}

// ---------------------------------------------------------------------------
// controle de caixa (turnos de gaveta)
// ---------------------------------------------------------------------------
