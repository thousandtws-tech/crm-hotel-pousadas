// Contratos do domínio clientes (extraído de api.models.ts).

export interface Cliente {
  id: number;
  nome: string;
  cpf: string;
  data_nascimento: string;
  email: string | null;
  telefone: string | null;
  estado: string | null;
  cidade: string | null;
  // -- dados complementares da FNRH --------------------------------------
  nacionalidade: string | null;
  naturalidade: string | null;
  profissao: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cep: string | null;
  pais: string | null;
  ativo: boolean;
  /** True quando há foto cadastrada — bytes em GET /clientes/{id}/foto. */
  tem_foto: boolean;
  version: number;
  criado_em: string;
  atualizado_em: string;
}

export interface ClienteInput {
  nome: string;
  cpf: string;
  data_nascimento: string;
  email?: string | null;
  telefone?: string | null;
  estado?: string | null;
  cidade?: string | null;
  nacionalidade?: string | null;
  naturalidade?: string | null;
  profissao?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cep?: string | null;
  pais?: string | null;
  /** Concorrência otimista — só no PUT. */
  version?: number;
}

// -- documentos de identidade do hóspede -------------------------------------

export type TipoDocumento = 'rg' | 'cpf' | 'cnh' | 'passaporte' | 'rne' | 'outro';

export const TIPOS_DOCUMENTO: Record<TipoDocumento, string> = {
  rg: 'RG',
  cpf: 'CPF',
  cnh: 'CNH',
  passaporte: 'Passaporte',
  rne: 'RNE',
  outro: 'Outro',
};

export interface ClienteDocumento {
  id: number;
  idcliente: number;
  tipo: TipoDocumento;
  numero: string;
  orgao_emissor: string | null;
  uf_emissor: string | null;
  pais_emissor: string | null;
  validade: string | null;
  /** True quando há scan digitalizado — bytes em GET /documentos/{id}/scan. */
  tem_scan: boolean;
  version: number;
  criado_em: string;
  atualizado_em: string;
}

export interface DocumentoInput {
  tipo: TipoDocumento;
  numero: string;
  orgao_emissor?: string | null;
  uf_emissor?: string | null;
  pais_emissor?: string | null;
  validade?: string | null;
  /** Concorrência otimista — só no PUT. */
  version?: number;
}

// -- acompanhantes da reserva --------------------------------------------------
