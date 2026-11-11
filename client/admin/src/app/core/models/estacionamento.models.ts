// Contratos do domínio estacionamento (extraído de api.models.ts).

export interface VagaEstacionamento {
  id: number;
  idacomodacao: number | null;
  numero: string;
  ativo: boolean;
  version: number;
  criado_em: string;
}
