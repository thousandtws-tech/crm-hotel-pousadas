// Contratos do domínio pdv (extraído de api.models.ts).

import { Page } from './comum.models';
import { ContaFinanceira } from './financeiro.models';
import { Funcionario } from './funcionarios.models';
import { FormaPagamento } from './pagamentos.models';
import { ReservaResumo } from './reservas.models';

export type PdvComandaTipo = 'mesa' | 'quarto' | 'balcao';
export type PdvComandaStatus = 'aberta' | 'fechada' | 'cancelada';
export type PdvItemStatus = 'pendente' | 'em_preparo' | 'pronto' | 'entregue' | 'cancelado';
export type PdvComissaoStatus = 'pendente' | 'paga';

export interface MesaView {
  id: number;
  numero: string;
  lugares: number;
  ativo: boolean;
  idcomanda: number | null;
  total_aberto: string | null;
  garcom_nome: string | null;
}

export interface GarcomView {
  id: number;
  idfuncionario: number;
  funcionario_nome: string;
  percentual: string;
  ativo: boolean;
}

export interface ComandaView {
  id: number;
  tipo: PdvComandaTipo;
  idmesa: number | null;
  mesa_numero: string | null;
  idquarto: number | null;
  quarto_numero: string | null;
  idreserva: number | null;
  idcliente: number | null;
  cliente_nome: string | null;
  idgarcom: number | null;
  garcom_nome: string | null;
  rotulo: string | null;
  status: PdvComandaStatus;
  total_itens: string;
  itens_pendentes: number;
  desconto: string;
  total: string;
  idlancamento: number | null;
  aberto_em: string;
  fechado_em: string | null;
  version: number;
}

export interface ComandaItemView {
  id: number;
  idcomanda: number;
  iditem: number;
  item_nome: string;
  categoria_nome: string | null;
  quantidade: number;
  valor_unit: string;
  valor_total: string;
  status: PdvItemStatus;
  lancado_por: number | null;
  lancado_por_nome: string | null;
  cancelado_por_nome: string | null;
  motivo_cancelamento: string | null;
  criado_em: string;
}

export interface ItemVendaView {
  id: number;
  nome: string;
  categoria_nome: string | null;
  quantidade: number;
  valor_unitario: string;
}

export interface ComissaoView {
  id: number;
  idgarcom: number;
  garcom_nome: string;
  idcomanda: number;
  comanda_descricao: string;
  percentual: string;
  base: string;
  valor: string;
  status: PdvComissaoStatus;
  pago_em: string | null;
  criado_em: string;
}

export interface ComissaoResumo {
  idgarcom: number;
  garcom_nome: string;
  comissoes_pendentes: number;
  valor_pendente: string;
  valor_pago: string;
}

export interface AbrirComandaInput {
  tipo: PdvComandaTipo;
  idmesa?: number | null;
  idquarto?: number | null;
  idcliente?: number | null;
  idgarcom?: number | null;
  rotulo?: string | null;
}

export interface FecharComandaInput {
  modo: 'pagar' | 'faturar';
  desconto?: number | null;
  idconta_financeira?: number | null;
  idforma_pagamento?: number | null;
  observacao?: string | null;
}

export interface PdvMesa {
  id: number;
  numero: string;
  lugares: number;
  ativo: boolean;
  version: number;
}

export interface PdvGarcom {
  id: number;
  idfuncionario: number;
  percentual: string;
  ativo: boolean;
}

export interface PdvComanda {
  id: number;
  tipo: PdvComandaTipo;
  idmesa: number | null;
  idquarto: number | null;
  idreserva: number | null;
  idcliente: number | null;
  idgarcom: number | null;
  rotulo: string | null;
  status: PdvComandaStatus;
  subtotal: string;
  desconto: string;
  total: string;
  idforma_pagamento: number | null;
  idlancamento: number | null;
  aberto_em: string;
  fechado_em: string | null;
  observacao: string | null;
  version: number;
}

export interface PdvComandaItem {
  id: number;
  idcomanda: number;
  iditem: number;
  quantidade: number;
  valor_unit: string;
  valor_total: string;
  status: PdvItemStatus;
}

export interface PdvComissao {
  id: number;
  idgarcom: number;
  idcomanda: number;
  percentual: string;
  base: string;
  valor: string;
  status: PdvComissaoStatus;
  pago_em: string | null;
}

/** Item na fila da cozinha (KDS) — comanda aberta + contexto de destino. */
export interface FilaItemView {
  id: number;
  idcomanda: number;
  comanda_tipo: PdvComandaTipo;
  mesa_numero: string | null;
  quarto_numero: string | null;
  rotulo: string | null;
  cliente_nome: string | null;
  garcom_nome: string | null;
  iditem: number;
  item_nome: string;
  categoria_nome: string | null;
  quantidade: number;
  status: PdvItemStatus;
  criado_em: string;
  comanda_aberto_em: string;
}

// ---------------------------------------------------------------------------
// Café da manhã — presença por reserva/dia
// ---------------------------------------------------------------------------

/** Painel consolidado do PDV — as 9 leituras do boot em 1 request. */
export interface PainelPdv {
  mesas: MesaView[];
  comandas: Page<ComandaView>;
  comandas_abertas: ComandaView[];
  garcons: GarcomView[];
  itens_venda: ItemVendaView[];
  contas: ContaFinanceira[];
  formas: FormaPagamento[];
  funcionarios: Funcionario[];
  reservas_estadia: ReservaResumo[];
}
