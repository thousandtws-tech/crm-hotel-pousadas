// Contratos do domínio estoque (extraído de api.models.ts).
import { TipoMovimento } from './comum.models';
import { Impressora } from './estabelecimento.models';

export interface CategoriaEstoque {
  id: number;
  nome: string;
  /** Impressora do setor para tickets de produção (KOT). */
  impressora_id?: number | null;
  ativo: boolean;
  version: number;
  criado_em: string;
}

/** Impressora térmica de rede por setor. */
export interface ItemEstoque {
  id: number;
  nome: string;
  idcategoria: number | null;
  quantidade: number;
  valor_unitario: string;
  unidade: string;
  estoque_minimo: number;
  eh_insumo: boolean;
  ativo: boolean;
  version: number;
  criado_em: string;
  atualizado_em: string;
}

export interface ItemEstoqueInput {
  nome: string;
  idcategoria?: number | null;
  quantidade_inicial?: number | null;
  valor_unitario?: number | string | null;
  unidade?: string | null;
  estoque_minimo?: number | null;
  eh_insumo?: boolean;
  /** Concorrência otimista — só no PUT. */
  version?: number;
}

export interface ItemEstoqueUpdate {
  nome?: string;
  idcategoria?: number | null;
  unidade?: string | null;
  estoque_minimo?: number | null;
  eh_insumo?: boolean;
  valor_unitario?: number | string | null;
  version?: number;
}

export interface MovimentoView {
  id: number;
  iditem: number;
  item_nome: string;
  tipo: TipoMovimento;
  quantidade: number;
  funcionario: string | null;
  motivo: string;
  criado_em: string;
}

export interface MovimentacaoInput {
  iditem: number;
  tipo: TipoMovimento;
  quantidade: number;
  motivo?: string;
}

// -- relatórios ----------------------------------------------------------------

export interface FichaItemView {
  id: number;
  idinsumo: number;
  insumo: string;
  unidade: string;
  quantidade: number;
  custo_unit: string;
}

export interface FichaItemInput {
  idinsumo: number;
  quantidade: number;
}

export interface ConversaoUnidade {
  id: number;
  iditem: number;
  unidade_compra: string;
  fator: number;
  criado_em: string;
}

export interface ConversaoInput {
  unidade_compra: string;
  fator: number;
}

export interface EstoqueBaixoView {
  id: number;
  nome: string;
  unidade: string;
  quantidade: number;
  estoque_minimo: number;
}

export interface NfeItemPreview {
  nome: string;
  unidade_compra: string;
  quantidade: string;
  valor_unit: string;
  valor_total: string;
  iditem_sugerido: number | null;
  fator_sugerido: number | null;
}

export interface NfePreview {
  chave: string;
  numero: string | null;
  emitente: string | null;
  cnpj: string | null;
  emissao: string | null;
  total: string;
  ja_importada: boolean;
  itens: NfeItemPreview[];
}

export interface NfeItemInput {
  iditem: number | null;
  nome: string;
  unidade_compra: string;
  fator?: number | null;
  quantidade: number | string;
  valor_total: number | string;
}

export interface NfeImportRequest {
  chave: string;
  numero?: string | null;
  emitente?: string | null;
  cnpj?: string | null;
  emissao?: string | null;
  total: number | string;
  vencimento?: string | null;
  gerar_pagamento?: boolean;
  itens: NfeItemInput[];
}

export interface NfeImport {
  id: number;
  chave: string;
  numero: string | null;
  emitente: string | null;
  total: string;
  idlancamento: number | null;
  criado_em: string;
}
