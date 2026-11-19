// Contratos do domínio reservas (extraído de api.models.ts).
import { StatusConsumo, StatusReserva } from './comum.models';

export interface Acompanhante {
  id: number;
  idreserva: number;
  nome: string;
  data_nascimento: string | null;
  parentesco: string | null;
  doc_tipo: string | null;
  doc_numero: string | null;
  criado_em: string;
}

export interface AcompanhanteInput {
  nome: string;
  data_nascimento?: string | null;
  parentesco?: string | null;
  doc_tipo?: string | null;
  doc_numero?: string | null;
}

// -- FNRH (ficha nacional de registro de hóspedes) -----------------------------

/** Snapshot imutável gravado na emissão — a ficha impressa renderiza isso. */
export interface FnrhDados {
  hospede: {
    nome: string;
    cpf: string;
    data_nascimento: string;
    nacionalidade: string | null;
    naturalidade: string | null;
    profissao: string | null;
    email: string | null;
    telefone: string | null;
    logradouro: string | null;
    numero: string | null;
    complemento: string | null;
    bairro: string | null;
    cidade: string | null;
    estado: string | null;
    cep: string | null;
    pais: string | null;
    tem_foto: boolean;
  };
  reserva: {
    id: number;
    acomodacao: string;
    acomodacao_numero: number;
    quarto: string | null;
    entradaprevista: string;
    saidaprevista: string;
    checkin_em: string | null;
    quantidade_hospedes: number;
  };
  acompanhantes: Acompanhante[];
  emitida_por: string;
}

export interface Fnrh {
  id: number;
  idreserva: number;
  idcliente: number;
  motivo_viagem: string | null;
  placa_veiculo: string | null;
  dados: FnrhDados;
  emitida_por: number | null;
  emitida_em: string;
}

// -- catálogo ------------------------------------------------------------------

export interface MapaQuarto {
  id: number;
  nome: string;
  numero: number;
  andar: number;
  cor: string;
  tipo: string | null;
  idreserva_hoje: number | null;
  status_hoje: string | null;
  bloqueado: boolean;
  limpeza_pendente: number;
  manut_aberta: number;
}

/** Painel consolidado da Recepção — 1 request, dados do dia em paralelo. */
export interface PainelRecepcao {
  chegadas: ReservaResumo[];
  na_casa: ReservaResumo[];
  mapa: MapaQuarto[];
}

export interface Bloqueio {
  id: number;
  idacomodacao: number;
  inicio: string;
  fim: string;
  motivo: string;
  criado_por: number | null;
  criado_em: string;
}

// -- reservas ------------------------------------------------------------------

export interface Reserva {
  id: number;
  idacomodacao: number;
  idcliente: number;
  idquarto: number | null;
  quantidade_hospedes: number;
  entradaprevista: string;
  saidaprevista: string;
  checkin_em: string | null;
  checkout_em: string | null;
  obs: string | null;
  status: StatusReserva;
  valordiaria: string;
  criado_em: string;
  atualizado_em: string;
}

export interface ReservaResumo {
  id: number;
  idacomodacao: number;
  acomodacao_nome: string;
  acomodacao_numero: number;
  acomodacao_cor: string;
  idcliente: number;
  cliente_nome: string;
  quantidade_hospedes: number;
  entradaprevista: string;
  saidaprevista: string;
  status: StatusReserva;
  valordiaria: string;
  idquarto: number | null;
  quarto_numero: string | null;
  valor_estadia: string | null;
}

export interface ConsumoResumo {
  id: number;
  status: StatusConsumo;
  valor_estadia: string;
  valor_itens: string;
  valor_adicional: string;
  total_desconto: string;
  valor_final: string | null;
  idforma_pagamento: number | null;
  forma_pagamento: string | null;
  comprovante: string | null;
  fechado_em: string | null;
}

export interface ReservaDetalhe extends Omit<Reserva, 'atualizado_em'> {
  quarto_numero: string | null;
  acomodacao_nome: string;
  acomodacao_numero: number;
  acomodacao_valor: string;
  cliente_nome: string;
  cliente_cpf: string;
  consumo: ConsumoResumo | null;
}

export interface ReservaInput {
  idacomodacao: number;
  idcliente: number;
  quantidade_hospedes: number;
  entradaprevista: string;
  saidaprevista: string;
  obs?: string | null;
  valordiaria?: string | number | null;
  early_checkin?: boolean;
  late_checkout?: boolean;
}

export interface ItemConsumido {
  id: number;
  idconsumo: number;
  iditem: number;
  nome: string;
  quantidade: number;
  valor_total: string;
  criado_em: string;
}

export interface AdicionalConsumo {
  id: number;
  idconsumo: number;
  motivo: string;
  valor: string;
  criado_em: string;
}

export interface CheckoutRequest {
  idforma_pagamento: number;
  total_desconto?: number | string | null;
  adicionais: { motivo: string; valor: number | string }[];
}

export interface CheckoutResponse {
  reserva: Reserva;
  consumo: ConsumoResumo;
}

export interface CancelarReservaRequest {
  motivo?: string | null;
  login_admin?: string | null;
  senha_admin?: string | null;
}

export interface AcomodacaoDisponivel {
  id: number;
  nome: string;
  numero: number;
  valor: string;
  capacidade: number;
}

export interface DisponibilidadeResponse {
  disponivel: boolean;
  quantidade: number;
  diarias: number;
  inicio: string;
  fim: string;
  acomodacoes: AcomodacaoDisponivel[];
}

// -- estoque -------------------------------------------------------------------

// -- helpers de apresentação -----------------------------------------------------

export const STATUS_RESERVA: Record<
  StatusReserva,
  { rotulo: string; cor: string; texto: string }
> = {
  p: { rotulo: 'Pendente', cor: '#ffc107', texto: '#000' },
  i: { rotulo: 'Iniciado', cor: '#3498db', texto: '#fff' },
  c: { rotulo: 'Cancelado', cor: '#dc3545', texto: '#fff' },
  f: { rotulo: 'Finalizado', cor: '#198754', texto: '#fff' },
};
