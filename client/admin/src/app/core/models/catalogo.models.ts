// Contratos do domínio catalogo (extraído de api.models.ts).

export interface TipoAcomodacao {
  id: number;
  nome: string;
  ativo: boolean;
  version: number;
  criado_em: string;
}

export interface Acomodacao {
  id: number;
  idtipo_acomodacao: number | null;
  nome: string;
  numero: number;
  andar: number;
  valor: string;
  capacidade: number;
  descricao: string | null;
  cor: string;
  ativo: boolean;
  version: number;
  criado_em: string;
  atualizado_em: string;
}

export interface AcomodacaoInput {
  idtipo_acomodacao?: number | null;
  nome: string;
  numero: number;
  andar?: number;
  valor?: string | number | null;
  capacidade: number;
  descricao?: string | null;
  cor?: string | null;
  version?: number;
}

export interface Quarto {
  id: number;
  idacomodacao: number;
  numero: string;
  ativo: boolean;
  version: number;
  criado_em: string;
}

/** Faixa de diária por nº de hóspedes, por tipo de acomodação. */
export interface TarifaOcupacao {
  id: number;
  idtipo_acomodacao: number;
  hospedes: number;
  valor: string;
}

export interface TarifaOcupacaoInput {
  hospedes: number;
  valor: number | string;
}

/** Diária diferenciada para as noites de um período (fds, feriados,
 * alta temporada) — sobrepõe a tarifa por ocupação e a base. */
export interface TarifaPeriodo {
  id: number;
  idacomodacao: number;
  inicio: string;
  fim: string;
  valor: string;
  rotulo: string | null;
  prioridade: number;
  criado_em: string;
}

export interface TarifaPeriodoInput {
  inicio: string;
  fim: string;
  valor: number | string;
  rotulo?: string | null;
  prioridade?: number;
}

/** Grupo/evento — rooming list + bloqueio em massa + reservas vinculadas. */
export interface Grupo {
  id: number;
  nome: string;
  contato: string | null;
  idoperadora: number | null;
  operadora_nome: string | null;
  obs: string | null;
  inicio: string;
  fim: string;
  criado_por: number | null;
  criado_em: string;
}

export interface GrupoInput {
  nome: string;
  contato?: string | null;
  idoperadora?: number | null;
  obs?: string | null;
  inicio: string;
  fim: string;
  unidades: number[];
  bloquear?: boolean;
}

export interface GrupoUnidadeView {
  id: number;
  idacomodacao: number;
  acomodacao_nome: string;
  acomodacao_numero: number;
  idreserva: number | null;
  hospede: string | null;
  reserva_status: string | null;
}

// ---------------------------------------------------------------------------
// CMS — conteúdo editorial + mídia do site público
// ---------------------------------------------------------------------------
