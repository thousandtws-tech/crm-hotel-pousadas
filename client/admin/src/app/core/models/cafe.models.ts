// Contratos do domínio cafe (extraído de api.models.ts).

export interface CafeQuadroItem {
  idreserva: number;
  cliente_nome: string;
  quantidade_hospedes: number;
  quarto_numero: string | null;
  acomodacao_nome: string;
  entradaprevista: string;
  saidaprevista: string;
  presenca_id: number | null;
  presenca_quantidade: number | null;
  presenca_em: string | null;
  registrado_por_nome: string | null;
}

export interface CafePresenca {
  id: number;
  idreserva: number;
  data: string;
  quantidade: number;
  registrado_por: number | null;
  criado_em: string;
}

export interface PresencaView {
  id: number;
  idreserva: number;
  data: string;
  quantidade: number;
  cliente_nome: string;
  quarto_numero: string | null;
  registrado_por_nome: string | null;
  criado_em: string;
}

// ---------------------------------------------------------------------------
// estoque & insumos — ficha tecnica, conversoes, alertas, NF-e
// ---------------------------------------------------------------------------
