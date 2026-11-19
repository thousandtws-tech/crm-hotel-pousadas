// Contratos do domínio frigobares (extraído de api.models.ts).

import { Acomodacao } from './catalogo.models';
import { CategoriaEstoque, ItemEstoque } from './estoque.models';

export interface Frigobar {
  id: number;
  idacomodacao: number;
  modelo: string | null;
  patrimonio: string | null;
  ativo: boolean;
  version: number;
  criado_em: string;
}

export interface ItemFrigobar {
  id: number;
  idfrigobar: number;
  iditem: number;
  quantidade: number;
  ativo: boolean;
  version: number;
  criado_em: string;
}

export interface ItemFrigobarView extends ItemFrigobar {
  item_nome: string;
  valor_unitario: string;
}

/** Painel consolidado do Frigobar — 4 leituras do boot em 1 request. */
export interface PainelFrigobares {
  frigobares: Frigobar[];
  acomodacoes: Acomodacao[];
  itens: ItemEstoque[];
  categorias: CategoriaEstoque[];
}
