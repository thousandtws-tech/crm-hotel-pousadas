import { Funcionario } from './funcionarios.models';
// Contratos do domínio operacao (extraído de api.models.ts).

export type PrioridadeManut = 'baixa' | 'media' | 'alta' | 'urgente';
export type StatusManut = 'aberta' | 'em_execucao' | 'aguardando_peca' | 'concluida' | 'cancelada';
export type TipoTarefaGov = 'checkout' | 'stayover' | 'semanal' | 'area_comum' | 'extra';
export type StatusTarefaGov = 'pendente' | 'em_andamento' | 'concluida' | 'cancelada';
export type StatusLoteLav = 'enviado' | 'devolvido_parcial' | 'devolvido' | 'fechado';
export type RegimeEscala = '5x1' | '6x1' | '12x36';

export interface ManutOrdem {
  id: number;
  idquarto: number | null;
  local: string;
  titulo: string;
  descricao: string;
  prioridade: PrioridadeManut;
  status: StatusManut;
  custo_centavos: number;
  responsavel: string | null;
  aberta_em: string;
  concluida_em: string | null;
}

export interface PmocRegistro {
  id: number;
  referente_a: string;
  itens: { item: string; conforme: boolean; obs: string }[];
  conformes: number;
  responsavel_nome: string;
  responsavel_crea: string;
  responsavel_art: string;
  observacoes: string;
  proxima_data: string | null;
  criado_em: string;
}

export interface GovTarefa {
  id: number;
  idquarto: number | null;
  data: string;
  tipo: TipoTarefaGov;
  status: StatusTarefaGov;
  estimado_min: number;
  idfuncionario: number | null;
  origem: string;
  observacao: string;
}

export interface PrevisaoDia {
  data: string;
  checkouts: number;
  stayovers: number;
  demanda_min: number;
  capacidade_min: number;
  situacao: 'ok' | 'sobrecarga' | 'sem_equipe';
}

export interface LavLote {
  id: number;
  fornecedor: string;
  competencia: string;
  enviado_em: string;
  devolvido_em: string | null;
  qtd_itens: number;
  qtd_devolvida: number;
  custo_centavos: number;
  status: StatusLoteLav;
  observacao: string;
}

export interface EnxovalMov {
  id: number;
  tipo_item: string;
  quantidade: number;
  origem: string;
  destino: string;
  data: string;
}

export interface FuncionarioJornada {
  id: number;
  idfuncionario: number;
  regime: RegimeEscala;
  entrada: string;
  saida: string;
  almoco_min: number;
  ancora: string;
  ativo: boolean;
}

export interface EscalaTurno {
  id: number;
  idfuncionario: number;
  data: string;
  inicio: string;
  fim: string;
  almoco_min: number;
  origem: string;
}

export interface CltViolacao {
  idfuncionario: number;
  funcionario_nome: string;
  regra: string;
  detalhe: string;
  data: string;
  severidade: 'alta' | 'media';
  correcao: { acao: string } & Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Inteligência preditiva (Maria — /ia/*)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Painéis consolidados — 1 request por tela de operação
// ---------------------------------------------------------------------------

/** Governança — quadro + previsão + lavanderia + enxoval + funcionários (6→1). */
export interface PainelGovernanca {
  tarefas: GovTarefa[];
  previsao: PrevisaoDia[];
  lotes: LavLote[];
  movs_enxoval: EnxovalMov[];
  saldo_enxoval: [string, number][];
  funcionarios: Funcionario[];
}

/** Manutenção & PMOC — ordens + checklist (2→1). */
export interface PainelManutencao {
  ordens: ManutOrdem[];
  pmoc_itens: string[];
}

/** Escalas & CLT — turnos + jornadas + violações (gerencial) + funcionários (4→1). */
export interface PainelEscalas {
  turnos: EscalaTurno[];
  jornadas: FuncionarioJornada[];
  violacoes_clt: CltViolacao[] | null;
  funcionarios: Funcionario[];
}
