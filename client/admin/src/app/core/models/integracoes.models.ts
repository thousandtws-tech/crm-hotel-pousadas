// Integrações de pagamento — um registro por par (provedor × ambiente), com
// credenciais cifradas no servidor. A API NUNCA devolve valores de segredos:
// `segredos.campos` diz apenas quais campos já estão configurados (write-only).

export type ProvedorPagamento = 'stripe' | 'pagbank' | 'mercadopago';
export type AmbienteIntegracao = 'producao' | 'teste';

export type EstadoIntegracao =
  'ativa' | 'pendente' | 'falha' | 'desativada' | 'gerenciado_pelo_ambiente' | 'nao_configurada';

export interface IntegracaoView {
  provedor: ProvedorPagamento;
  ambiente: AmbienteIntegracao;
  estado: EstadoIntegracao;
  habilitado: boolean;
  nome_conta: string | null;
  capabilities: Record<string, boolean>;
  /** URL que o provedor deve chamar com eventos — segura para exibir/copiar. */
  webhook_url: string | null;
  /** campo → configurado. Nunca contém valores. */
  segredos: { campos: Record<string, boolean> };
  ultima_verificacao_em: string | null;
  verificacao_status: 'ok' | 'falha' | null;
  verificacao_erro: string | null;
  /** Trava de concorrência otimista — PUT devolve 409 quando defasada. */
  versao: number;
  /** É o provedor padrão das novas cobranças do site. */
  padrao_site: boolean;
}

/**
 * PUT /integracoes/:provedor/:ambiente — `segredos` ausente mantém tudo,
 * campo presente substitui, string vazia remove.
 */
export interface IntegracaoInput {
  versao: number;
  segredos?: Record<string, string>;
  nome_conta?: string;
  webhook_url?: string;
}

/** Resposta de POST .../testar — verificação ao vivo das credenciais. */
export interface TesteIntegracao {
  verificacao_status: string;
  nome_conta: string | null;
  mensagem: string;
}

export interface EventoIntegracaoView {
  event_id: string;
  event_type: string;
  /** 'recebido' | 'processado' | 'falhou' | 'ignorado' */
  status: string;
  ultimo_erro: string | null;
  recebido_em: string;
  processado_em: string | null;
}
