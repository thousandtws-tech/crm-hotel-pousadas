// Contratos do domínio estabelecimento (extraído de api.models.ts).

export interface Estabelecimento {
  id: number;
  cnpj: string | null;
  razao_social: string | null;
  site: string | null;
  impressora_ip?: string | null;
  impressora_porta?: number;
  impressora_ativa?: boolean;
  email: string | null;
  telefone: string | null;
  celular: string | null;
  taxa_early?: number;
  taxa_late?: number;
  wifi_nome?: string | null;
  wifi_senha?: string | null;
  horario_checkin?: string | null;
  horario_checkout?: string | null;
  horario_cafe?: string | null;
  info_servicos?: string | null;
  cadastur?: string | null;
  politica_cancelamento?: unknown;
  retencao_dados_anos?: number;
  dpo_email?: string | null;
  google_review_url?: string | null;
  fnrh_assinatura?: boolean;
  version?: number;
}

export interface EnderecoEstabelecimento {
  id: number;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  cep: string | null;
  version?: number;
}

// -- LGPD ----------------------------------------------------------------------

export interface Impressora {
  id: number;
  nome: string;
  setor: string;
  ip: string;
  porta: number;
  ativa: boolean;
  /** Impressora padrão de comprovantes. */
  padrao: boolean;
  /** Impressora dedicada a etiquetas de produto. */
  etiqueta: boolean;
  version: number;
  criado_em: string;
}

export interface ImpressoraDescoberta {
  id: number;
  tipo: 'rede' | 'usb';
  endereco: string;
  porta: number | null;
  modelo: string | null;
  origem: string;
  status: 'pendente' | 'registrada' | 'ignorada';
  impressora_id: number | null;
  visto_em: string;
}

// ---- Pagamentos online (Stripe) -------------------------------------------
