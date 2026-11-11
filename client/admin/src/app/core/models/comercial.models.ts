// Contratos do domínio comercial (extraído de api.models.ts).

export interface Operadora {
  id: number;
  nome: string;
  contato: string | null;
  email: string | null;
  telefone: string | null;
  comissao_pct: string;
  ativa: boolean;
  notas: string | null;
  criado_em: string;
}

export interface OperadoraInput {
  nome: string;
  contato?: string | null;
  email?: string | null;
  telefone?: string | null;
  comissao_pct?: number;
  notas?: string | null;
}

export interface FaturamentoLinha {
  idreserva: number;
  hospede: string;
  entrada: string;
  saida: string;
  status: string;
  valor_total: string;
}

export interface FaturamentoOperadora {
  operadora: Operadora;
  de: string;
  ate: string;
  reservas: number;
  valor_total: string;
  linhas: FaturamentoLinha[];
}

// ---------- Contratos corporativos ----------

export interface ContratoCorporativo {
  id: number;
  empresa: string;
  codigo: string;
  desconto_pct: string;
  vigente_de: string;
  vigente_ate: string;
  contato: string | null;
  email: string | null;
  ativo: boolean;
  notas: string | null;
  criado_em: string;
}

export interface ContratoInput {
  empresa: string;
  codigo: string;
  desconto_pct?: number;
  vigente_de: string;
  vigente_ate: string;
  contato?: string | null;
  email?: string | null;
  notas?: string | null;
}

export interface TarifaHistorico {
  id: number;
  idacomodacao: number;
  valor: string;
  vigente_desde: string;
  vigente_ate: string | null;
  criado_em: string;
}
