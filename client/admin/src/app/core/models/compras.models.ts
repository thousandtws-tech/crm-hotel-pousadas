// Contratos do domínio compras (extraído de api.models.ts).

export interface Fornecedor {
  id: number; nome: string; cnpj: string | null; contato: string | null;
  telefone: string | null; lead_time_dias: number; ativo: boolean;
  criado_em: string; atualizado_em: string;
}
/** Upsert por nome no backend — não existe update por id. */
export interface FornecedorInput {
  nome: string; cnpj?: string; contato?: string; telefone?: string; lead_time_dias?: number;
}
export interface PedidoCompraView {
  id: number; idfornecedor: number; fornecedor: string; fornecedor_cnpj: string | null;
  data_prevista: string; valor_total: string;
  status: "pendente" | "parcial" | "recebido" | "cancelado";
  origem: string; idlancamento: number | null; criado_por: string | null;
  observacao: string | null; total_itens: number; recebido_itens: number; criado_em: string;
}
export interface PedidoItemView {
  id: number; iditem: number; item: string; unidade: string;
  quantidade: number; quantidade_recebida: number; valor_unit: string | null;
}
export interface PedidoDetalhe { pedido: PedidoCompraView; itens: PedidoItemView[]; }
export interface PedidoCriado {
  pedido: {
    id: number;
    idfornecedor: number;
    data_prevista: string | null;
    valor_total: string;
    status: string;
    idlancamento: number | null;
  };
  itens: unknown[];
}
export interface PedidoCompraInput {
  idfornecedor: number; itens: { iditem: number; quantidade: number; valor_unit?: number }[];
  vencimento?: string; observacao?: string; gerar_pagamento?: boolean; origem?: string;
}
export interface RecebimentoItem { iditem: number; quantidade: number; }

/** Dispositivo de impressão detectado pelo agente local, aguardando registro. */
