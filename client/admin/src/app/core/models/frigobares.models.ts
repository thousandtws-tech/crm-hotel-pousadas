// Contratos do domínio frigobares (extraído de api.models.ts).

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
