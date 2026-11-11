// Contratos do domínio notificacoes (extraído de api.models.ts).

export interface Notificacao {
  id: number;
  tipo: 'info' | 'sucesso' | 'alerta';
  titulo: string;
  mensagem: string;
  autor_nome: string | null;
  dados: { idreserva?: number } | null;
  lida: boolean;
  criado_em: string;
}

// -- busca global (GET /busca) --------------------------------------------------

export interface ItemBusca {
  tipo: 'cliente' | 'reserva' | 'acomodacao' | 'funcionario' | 'estoque';
  id: number;
  titulo: string;
  sub: string | null;
  rota: string;
}

// -- tesouraria: contas a pagar/receber, conciliação, split IBS/CBS ------------
