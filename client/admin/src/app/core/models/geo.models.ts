// Contratos dos serviços públicos de geografia usados no cadastro:
// ViaCEP (CEP -> endereço) e REST Countries (países, bandeiras, DDI).
// Ambos gratuitos, sem chave — chamados direto do navegador.

/** Resposta de https://viacep.com.br/ws/{cep}/json/ */
export interface ViaCepResponse {
  cep?: string;
  logradouro?: string;
  complemento?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  /** ViaCEP devolve 200 com { erro: true } quando o CEP não existe. */
  erro?: boolean;
}

/** Resposta de https://brasilapi.com.br/api/cnpj/v1/{cnpj} */
export interface BrasilApiCnpj {
  cnpj?: string;
  razao_social?: string;
  nome_fantasia?: string;
  ddd_telefone_1?: string;
  email?: string | null;
  cep?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
  ddd_telefone_2?: string;
  descricao_tipo_de_logradouro?: string;
  descricao_situacao_cadastral?: string;
  /** Quadro de sócios — primeiro nome pode sugerir a pessoa de contato. */
  qsa?: { nome_socio?: string; qualificacao_socio?: string }[];
  /** BrasilAPI devolve erro HTTP com { message, type, name } no corpo. */
  message?: string;
  type?: string;
}

/** Erros BrasilAPI vêm como { name, message, type } no corpo do erro HTTP. */
export function msgErroCnpj(e: { error?: { type?: string } } | null): string {
  switch (e?.error?.type) {
    case 'not_found':
      return 'CNPJ não encontrado — preencha manualmente.';
    case 'bad_request':
      return 'CNPJ inválido — confira os dígitos.';
    case 'service_unavailable':
      return 'Consulta CNPJ indisponível no momento — preencha manualmente.';
    default:
      return 'Não foi possível consultar o CNPJ — preencha manualmente.';
  }
}

/** País normalizado para o seletor com bandeira. */
export interface PaisGeo {
  /** ISO 3166-1 alpha-2 — chave das imagens no flagcdn. */
  cca2: string;
  /** Nome em português (translations.por.common). */
  nome: string;
  /** DDI internacional já formatado ("+55"), quando disponível. */
  ddi: string | null;
}

/** Shape bruto relevante do REST Countries v3.1. */
export interface RestCountry {
  cca2?: string;
  name?: { common?: string };
  translations?: { por?: { common?: string } };
  idd?: { root?: string; suffixes?: string[] };
}

/** Nacionalidades frequentes no cadastro (texto livre com datalist). */
export const NACIONALIDADES: readonly string[] = [
  'Brasileira', 'Argentina', 'Uruguaia', 'Paraguaia', 'Chilena', 'Boliviana',
  'Peruana', 'Colombiana', 'Venezuelana', 'Americana', 'Canadense', 'Mexicana',
  'Portuguesa', 'Espanhola', 'Italiana', 'Francesa', 'Alemã', 'Inglesa',
  'Holandesa', 'Suíça', 'Belga', 'Irlandesa', 'Austríaca', 'Sueca', 'Norueguesa',
  'Dinamarquesa', 'Finlandesa', 'Polonesa', 'Russa', 'Ucraniana', 'Japonesa',
  'Chinesa', 'Coreana', 'Israelense', 'Libanesa', 'Australiana', 'Neozelandesa',
  'Sul-africana', 'Angolana', 'Moçambicana', 'Cabo-verdiana', 'Cubana',
  'Dominicana', 'Haitiana', 'Equatoriana', 'Guianense', 'Surinamesa',
];
