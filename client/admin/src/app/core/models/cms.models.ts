// Contratos do domínio cms (extraído de api.models.ts).
import { Acomodacao } from './catalogo.models';

export interface AcomodacaoCms {
  id: number;
  idacomodacao: number;
  slug: string;
  subtitulo: string | null;
  descricao_curta: string | null;
  descricao_longa: string | null;
  destaque_editorial: string | null;
  camas: string | null;
  banheiros: number | null;
  metragem: string | null;
  vista: string | null;
  andar: string | null;
  comodidades: Comodidade[];
  status: 'rascunho' | 'publicado';
  destaque: boolean;
  ordem: number;
  publicado_em: string | null;
  version: number;
  criado_em: string;
  atualizado_em: string;
}

export interface Comodidade {
  name: string;
  icon: string;
  highlight?: boolean;
}

export interface Midia {
  id: number;
  tipo: 'foto' | 'video';
  url: string;
  capa: boolean;
  ordem: number;
}

export interface AcomodacaoCmsView extends Acomodacao {
  cms: AcomodacaoCms | null;
  midias: Midia[];
}

export interface CmsInput {
  slug?: string | null;
  subtitulo?: string | null;
  descricao_curta?: string | null;
  descricao_longa?: string | null;
  destaque_editorial?: string | null;
  camas?: string | null;
  banheiros?: number | null;
  metragem?: string | number | null;
  vista?: string | null;
  andar?: string | null;
  comodidades?: Comodidade[];
  destaque?: boolean;
  ordem?: number;
  version?: number;
}

/** Seção editável do site institucional (`cms_site` — dados é jsonb livre). */
export interface CmsSecao {
  id: number;
  secao: string;
  dados: Record<string, unknown>;
  ordem: number;
  visivel: boolean;
  atualizado_em: string;
}

export type CmsSecaoDados = Record<string, unknown>;

// ---------- Operadoras B2B ----------
