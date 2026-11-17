// Integrações — um registro por par (provedor × ambiente), com credenciais
// cifradas no servidor. A API NUNCA devolve valores de segredos:
// `segredos.campos` diz apenas quais campos já estão configurados (write-only).
// Categorias: 'pagamento' (Stripe/PagBank/Mercado Pago ×2 ambientes) e
// 'comunicacao' (Z-API/WhatsApp — só producao).

export type ProvedorIntegracao = 'stripe' | 'pagbank' | 'mercadopago' | 'zapi';

/** @deprecated Alias legado — prefira `ProvedorIntegracao`. */
export type ProvedorPagamento = ProvedorIntegracao;

export type AmbienteIntegracao = 'producao' | 'teste';

/** Grupo operacional do catálogo — vem sempre preenchida pela API. */
export type CategoriaIntegracao = 'pagamento' | 'comunicacao';

export type EstadoIntegracao =
  'ativa' | 'pendente' | 'falha' | 'desativada' | 'gerenciado_pelo_ambiente' | 'nao_configurada';

export interface IntegracaoView {
  provedor: ProvedorIntegracao;
  ambiente: AmbienteIntegracao;
  categoria: CategoriaIntegracao;
  estado: EstadoIntegracao;
  habilitado: boolean;
  nome_conta: string | null;
  capabilities: Record<string, unknown>;
  /**
   * Config não-secreta — segura para exibir. Z-API: `instance_id`,
   * `sessao` ({conectado, smartphone_conectado, telefone, verificado_em,
   * desconectado_em}) e `webhooks_configurados`.
   */
  config: Record<string, unknown>;
  /** URL que o provedor deve chamar com eventos — segura para exibir/copiar. */
  webhook_url: string | null;
  /** campo → configurado. Nunca contém valores. */
  segredos: { campos: Record<string, boolean> };
  ultima_verificacao_em: string | null;
  verificacao_status: 'ok' | 'falha' | null;
  verificacao_erro: string | null;
  /** Trava de concorrência otimista — PUT devolve 409 quando defasada. */
  versao: number;
  /** Provedor padrão do escopo — site (pagamento) ou whatsapp (comunicacao). */
  padrao_site: boolean;
}

/**
 * PUT /integracoes/:provedor/:ambiente — `segredos` ausente mantém tudo,
 * campo presente substitui, string vazia remove. `config` faz merge por
 * chave — Z-API aceita apenas `{"instance_id": "…"}`.
 */
export interface IntegracaoInput {
  versao: number;
  segredos?: Record<string, string>;
  nome_conta?: string;
  webhook_url?: string;
  config?: Record<string, unknown>;
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

// ---------------------------------------------------------------------------
// Z-API (categoria 'comunicacao', ambiente 'producao')
// ---------------------------------------------------------------------------

/**
 * Estado da sessão WhatsApp gravado em `config.sessao` — alimentado pelo
 * GET /status e pelos callbacks Connected/Disconnected. Credencial válida
 * e sessão conectada são coisas distintas.
 */
export interface ZapiSessao {
  conectado: boolean;
  smartphone_conectado?: boolean;
  telefone?: string | null;
  verificado_em?: string;
  desconectado_em?: string;
}

/** POST .../zapi/{ambiente}/qr-code — imagem base64 ou fluxo assistido. */
export type ZapiQrCode =
  { tipo: 'imagem'; valor: string } | { tipo: 'assistido'; mensagem: string };

/** POST .../zapi/{ambiente}/webhooks — registra os callbacks da instância. */
export interface ZapiWebhooksResultado {
  callbacks_configurados: number;
}

/** POST .../zapi/{ambiente}/teste-msg — envio único, sem retry automático. */
export interface ZapiTesteInput {
  /** Com DDI+DDD — o backend valida 10–15 dígitos. */
  telefone: string;
  texto?: string;
}

export interface ZapiTesteResultado {
  enviado: boolean;
  id_provedor: string | null;
}
