// Contratos do domínio estacionamento (extraído de api.models.ts).

import { Acomodacao } from './catalogo.models';

export interface VagaEstacionamento {
  id: number;
  idacomodacao: number | null;
  numero: string;
  ativo: boolean;
  version: number;
  criado_em: string;
}

/** Painel consolidado do Estacionamento — vagas + acomodações em 1 request. */
export interface PainelEstacionamento {
  vagas: VagaEstacionamento[];
  acomodacoes: Acomodacao[];
}
