// Motor de busca — contratos compartilhados entre a barra de pesquisa,
// a página /buscar e o endpoint público POST /publico/disponibilidade/busca.
// Datas e meses trafegam como strings civis ("YYYY-MM-DD" / "YYYY-MM").

export type ToleranceDays = 0 | 1 | 2 | 3 | 7 | 14;
export type StayPreset = 'weekend' | 'week' | 'month';
export type SearchMode = 'dates' | 'flexible';

export type DateQuery =
  | {
      mode: 'dates';
      checkIn: string;
      checkOut: string;
      toleranceDays: ToleranceDays;
    }
  | {
      mode: 'flexible';
      stayPreset: StayPreset;
      months: string[];
    };

export interface GuestQuery {
  adults: number;
  children: number;
  infants: number;
  pets: number;
}

export interface SearchQuery {
  date: DateQuery;
  guests: GuestQuery;
  acomodacaoSlug?: string;
}

export interface SearchAcomodacao {
  id: number;
  slug: string;
  nome: string;
  numero: number;
  capacidade: number;
  /** Diária já reprecificada pela faixa de ocupação. */
  valor: string;
}

export interface SearchAlternativa {
  inicio: string;
  fim: string;
  noites: number;
  /** Só modo dates — deslocamento em relação ao intervalo-base. */
  deslocamento?: number;
  acomodacoes: SearchAcomodacao[];
}

export interface SearchResponse {
  alternativas: SearchAlternativa[];
  /** Períodos candidatos consultados (após filtros de data). */
  periodos: number;
  /** Períodos com ao menos uma acomodação compatível. */
  com_disponibilidade: number;
  aviso?: string;
}

/** Rascunho editável dos contadores (pode começar zerado). */
export interface GuestsDraft {
  adults: number;
  children: number;
  infants: number;
  pets: number;
}
