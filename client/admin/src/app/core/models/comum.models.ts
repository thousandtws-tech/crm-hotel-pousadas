

// Contratos espelhando o backend clarituz-api (server/crates/*/dto + entities).
// Decimal chega como string — helpers em `brl()`/`num()` tratam conversão.

export interface ApiErro {
  erro: { codigo: string; mensagem: string };
}

export interface Page<T> {
  items: T[];
  page: number;
  per_page: number;
  total: number;
}

export type StatusReserva = 'p' | 'i' | 'c' | 'f';
export type StatusConsumo = 'pendente' | 'concluido' | 'cancelado' | 'reembolsado';
export type TipoMovimento = 'entrada' | 'saida';

// -- auth --------------------------------------------------------------------
