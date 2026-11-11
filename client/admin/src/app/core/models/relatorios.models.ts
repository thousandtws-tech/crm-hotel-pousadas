// Contratos do domínio relatorios (extraído de api.models.ts).
import { ReservaResumo } from './reservas.models';

export interface DashboardCards {
  total_acomodacoes: number;
  acomodacoes_disponiveis: number;
  acomodacoes_ocupadas: number;
  hospedes_atuais: number;
  checkins_hoje: number;
  checkouts_hoje: number;
  checkins_pendentes_hoje: number;
  checkouts_pendentes_hoje: number;
}

export interface PendenciaDia {
  idreserva: number;
  acomodacao_nome: string;
  cliente_nome: string;
  entradaprevista: string;
  saidaprevista: string;
}

export interface AcomodacaoBasica {
  id: number;
  nome: string;
  numero: number;
}

export interface DashboardResponse {
  cards: DashboardCards;
  ultimas_reservas: ReservaResumo[];
  checkins_pendentes: PendenciaDia[];
  checkouts_pendentes: PendenciaDia[];
  acomodacoes_disponiveis: AcomodacaoBasica[];
  acomodacoes_ocupadas: AcomodacaoBasica[];
}

export interface ResumoFinanceiro {
  recebido: string;
  recebido_estadias: string;
  recebido_itens: string;
  recebido_adicionais: string;
  previsto: string;
  descontos: string;
  qtd_contas_fechadas: number;
}

export interface PontoSerie {
  rotulo: string;
  valor: string;
  quantidade: number;
}

export interface ItemMaisVendido {
  nome: string;
  quantidade: number;
  valor: string;
}

export interface VendaItem {
  idreserva: number;
  item: string;
  quantidade: number;
  valor_total: string;
  criado_em: string;
}

export interface RegistroLog {
  id: number;
  idfuncionario: number | null;
  funcionario_nome: string | null;
  acao: string;
  obs: string | null;
  tabela: string | null;
  idtabela: number | null;
  dados: unknown;
  criado_em: string;
}

// -- notificações (inbox realtime) ------------------------------------------------
