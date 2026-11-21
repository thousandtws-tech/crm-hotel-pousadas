// Contratos do domínio comunicacao (extraído de api.models.ts).

export interface LgpdSolicitacao {
  id: number;
  idcliente: number | null;
  idreserva: number | null;
  tipo: string;
  detalhe: string | null;
  canal: string;
  status: 'aberta' | 'respondida' | 'executada';
  resposta: string | null;
  respondida_em: string | null;
  respondida_por: number | null;
  criado_em: string;
  atualizado_em: string;
}

// -- atendimento (roteamento por setor) ----------------------------------------
export interface Atendimento {
  id: number;
  protocolo: string;
  origem: string;
  setor: string;
  prioridade: 'normal' | 'urgente';
  status: 'aberto' | 'em_atendimento' | 'escalado' | 'resolvido' | 'encerrado';
  telefone: string | null;
  idreserva: number | null;
  idcliente: number | null;
  assunto: string;
  ultima_msg: string | null;
  motivo: string | null;
  idfuncionario: number | null;
  prazo_aceite: string;
  criado_em: string;
  atribuido_em: string | null;
  escalado_em: string | null;
  resolvido_em: string | null;
  tags: string[];
}

/** Nota interna do protocolo — contexto entre turnos, nunca vai ao hóspede. */
export interface AtendimentoNota {
  id: number;
  idatendimento: number;
  idfuncionario: number | null;
  texto: string;
  criado_em: string;
  funcionario_nome: string | null;
}

// -- mapa por andar + bloqueio ---------------------------------------------------
export type CanalEnvio = 'email' | 'whatsapp' | 'sms' | 'push' | 'inbox';
export type StatusEnvio =
  | 'pendente'
  | 'enviando'
  | 'enviado'
  | 'falhou'
  | 'cancelado'
  | 'suprimido'
  | 'desconhecido';
export type StatusAvaliacao = 'pendente' | 'respondida' | 'expirada';

export interface ItemFila {
  id: number;
  canal: CanalEnvio;
  destino: string;
  template: string;
  payload: Record<string, unknown>;
  idreserva: number | null;
  tentativas: number;
  ultimo_erro: string | null;
  status: StatusEnvio;
  dedup_key?: string | null;
  template_versao?: number;
  entregue_em?: string | null;
  lido_em?: string | null;
  agendado_para: string;
  criado_em: string;
  enviado_em: string | null;
}

export interface RegraMatriz {
  evento: string;
  canal: CanalEnvio;
  papel: number;
  ativo: boolean;
}

export interface Avaliacao {
  id: number;
  idreserva: number;
  plataforma: string;
  nota_geral: number | null;
  nota_limpeza: number | null;
  nota_atendimento: number | null;
  nota_custo: number | null;
  nota_localizacao: number | null;
  nps: number | null;
  comentario: string | null;
  resposta: string | null;
  status: StatusAvaliacao;
  criado_em: string;
}

export interface AvaliacoesDash {
  total: number;
  respondidas: number;
  taxa_resposta: number;
  media_geral: number | null;
  media_limpeza: number | null;
  media_atendimento: number | null;
  media_custo: number | null;
  media_localizacao: number | null;
  nps: number | null;
  plataformas: Record<string, { total: number; soma: number }>;
}

export interface NivelFidelidade {
  id: number;
  nome: string;
  min_diarias: number;
  desconto_pct: string;
  beneficios: string | null;
  ordem: number;
  ativo: boolean;
}

/** Resposta rápida — catálogo expandido por '/atalho' nos campos de resposta. */
export interface RespostaRapida {
  id: number;
  atalho: string;
  titulo: string;
  texto: string;
  ordem: number;
  ativo: boolean;
}

/**
 * Painel consolidado da página Comunicação — 6 leituras em 1 request.
 * Campos gerenciais vêm null para níveis sem acesso (antes eram 403).
 */
export interface PainelComunicacao {
  avaliacoes_dash: AvaliacoesDash | null;
  avaliacoes: Avaliacao[] | null;
  fila: ItemFila[] | null;
  matriz: RegraMatriz[] | null;
  lgpd: LgpdSolicitacao[];
  atendimentos: Atendimento[];
}

// -- operação: manutenção, governança, escalas -----------------------------------
