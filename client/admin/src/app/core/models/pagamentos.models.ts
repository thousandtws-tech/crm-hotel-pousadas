// Contratos do domínio pagamentos (extraído de api.models.ts).

export interface FormaPagamento {
  id: number;
  nome: string;
  ativo: boolean;
  version: number;
  criado_em: string;
}

export interface ComprovanteResumo {
  comprovante: string;
  idreserva: number;
  cliente: string;
  acomodacao: string;
}

export type StatusPagOnline =
  | 'pendente' | 'pago' | 'expirado' | 'falhou' | 'cancelado'
  | 'reembolso_parcial' | 'reembolsado';

export interface PagOnlineResumo {
  id: number;
  idreserva: number;
  tipo: 'integral' | 'sinal' | 'saldo';
  status: StatusPagOnline;
  valor_centavos: number;
  metodo: string | null;
  paid_em: string | null;
  criado_em: string;
  cliente_nome: string;
  acomodacao_nome: string;
  reembolsado_centavos: number;
  motivo: string | null;
}

export interface ResumoFinanceiroOnline {
  recebido_centavos: number;
  pendente_centavos: number;
  reembolsado_centavos: number;
  total_pagos: number;
  total_pendentes: number;
  total_recusados: number;
  card_centavos: number;
  pix_centavos: number;
}

export interface ReceitaAcomodacao {
  idacomodacao: number;
  nome: string;
  recebido_centavos: number;
  total_pagos: number;
}

// -- comunicação / reputação -----------------------------------------------------
