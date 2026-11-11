// Contratos do domínio caixa (extraído de api.models.ts).

export interface PendenciaReserva {
  id: number;
  cliente_nome: string;
  acomodacao_nome: string;
  entradaprevista: string;
  saidaprevista: string;
  dias_atraso: number;
}

export interface PendenciasFechamento {
  no_shows: PendenciaReserva[];
  checkouts_pendentes: PendenciaReserva[];
  contas_abertas: number;
  contas_total: number;
}

export type StatusTurno = 'aberto' | 'fechado';
export type TipoMovimentoCaixa = 'sangria' | 'suprimento';

export interface CaixaTurno {
  id: number;
  idconta_financeira: number;
  idoperador: number;
  saldo_inicial: string;
  aberto_em: string;
  fechado_em: string | null;
  valor_contado: string | null;
  valor_esperado: string | null;
  /** contado − esperado (negativo = quebra/falta, positivo = sobra). */
  quebra: string | null;
  status: StatusTurno;
  observacao: string | null;
  fechado_por: number | null;
  version: number;
  criado_em: string;
}

export interface TurnoView {
  id: number;
  idconta_financeira: number;
  conta_financeira: string;
  idoperador: number;
  operador: string;
  saldo_inicial: string;
  aberto_em: string;
  fechado_em: string | null;
  valor_contado: string | null;
  valor_esperado: string | null;
  quebra: string | null;
  status: StatusTurno;
  observacao: string | null;
  total_suprimentos: string;
  total_sangrias: string;
  version: number;
  criado_em: string;
}

export interface CaixaMovimento {
  id: number;
  idturno: number;
  tipo: TipoMovimentoCaixa;
  valor: string;
  motivo: string;
  idfuncionario: number;
  criado_em: string;
}

export interface MovimentoCaixaView {
  id: number;
  idturno: number;
  tipo: TipoMovimentoCaixa;
  valor: string;
  motivo: string;
  funcionario: string;
  criado_em: string;
}

export interface ConferenciaLinha {
  origem: string;
  descricao: string;
  valor: string;
  sinal: number;
  criado_em: string;
}

/** Conferência automática: esperado derivado do ledger. */
export interface ConferenciaCaixa {
  turno: TurnoView;
  fundo: string;
  suprimentos: string;
  sangrias: string;
  recebimentos: string;
  pagamentos: string;
  especie: string;
  esperado: string;
  movimentos: MovimentoCaixaView[];
  linhas: ConferenciaLinha[];
}

export interface AbrirCaixaInput {
  idconta_financeira: number;
  saldo_inicial: number;
  observacao?: string | null;
}

export interface MovCaixaInput {
  tipo: TipoMovimentoCaixa;
  valor: number;
  motivo: string;
}

export interface FecharCaixaInput {
  valor_contado: number;
  observacao?: string | null;
}



// ---------------------------------------------------------------------------
// PDV & comandas
// ---------------------------------------------------------------------------
