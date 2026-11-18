// Integrações — um registro por par (provedor × ambiente), com credenciais
// cifradas no servidor. A API NUNCA devolve valores de segredos:
// `segredos.campos` diz apenas quais campos já estão configurados (write-only).
// Categorias: 'pagamento' (Stripe/PagBank/Mercado Pago ×2 ambientes) e
// 'comunicacao' (Z-API/WhatsApp — só producao).

export type ProvedorIntegracao =
  | 'stripe'
  | 'pagbank'
  | 'mercadopago'
  | 'zapi'
  | 'spedy'
  | 'didit'
  | 'channex';

/** @deprecated Alias legado — prefira `ProvedorIntegracao`. */
export type ProvedorPagamento = ProvedorIntegracao;

export type AmbienteIntegracao = 'producao' | 'teste';

/** Grupo operacional do catálogo — vem sempre preenchida pela API. */
export type CategoriaIntegracao =
  | 'pagamento'
  | 'comunicacao'
  | 'fiscal'
  | 'seguranca'
  | 'distribuicao';

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

// ---------------------------------------------------------------------------
// Spedy (categoria 'fiscal') — NFS-e de hospedagem/serviços.
// ---------------------------------------------------------------------------

/** POST .../spedy/{ambiente}/empresa — empresa vinculada à X-Api-Key. */
export interface SpedyEmpresa {
  id: string;
  cnpj: string | null;
  razao_social: string | null;
}

/** GET .../spedy/{ambiente}/settings — settings atuais da empresa remota. */
export type SpedyEmpresaSettings = Record<string, unknown>;

/** GET .../spedy/{ambiente}/municipio/{ibge} — provedores e obrigatoriedades. */
export type SpedyMunicipioSettings = Record<string, unknown>;

/** Status interno do documento — mapeado do `status_remoto`, nunca do POST. */
export type StatusFiscal =
  | 'rascunho'
  | 'enfileirada'
  | 'processando'
  | 'autorizada'
  | 'rejeitada'
  | 'cancelamento_solicitado'
  | 'cancelada'
  | 'falha';

export interface FiscalDocumento {
  id: number;
  idintegracao: number;
  idreserva: number | null;
  modelo: string;
  integration_id: string;
  remote_id: string | null;
  status: StatusFiscal;
  status_remoto: string | null;
  processing_detail: string | null;
  tomador: Record<string, unknown>;
  payload: Record<string, unknown>;
  valor_total: string;
  descricao: string | null;
  competencia: string | null;
  motivo_cancelamento: string | null;
  numero_nota: string | null;
  url_consulta: string | null;
  ultimo_erro: string | null;
  tentativas: number;
  proxima_tentativa: string | null;
  transmitido_em: string | null;
  autorizado_em: string | null;
  cancelado_em: string | null;
  criado_em: string;
  atualizado_em: string;
}

export interface FiscalDocumentoView extends FiscalDocumento {
  reserva: number | null;
}

/** POST .../fiscal/nfse/{ambiente}/reserva/{id}/preparar — prévia para revisão. */
export interface PreparaNfse {
  iddocumento: number;
  tomador: Record<string, unknown>;
  valor_total: string;
  descricao: string;
  competencia: string;
  aviso: string;
  pendencias: string[];
}

export interface PrepararNfseInput {
  tomadorNome?: string;
  tomadorDocumento?: string;
  tomadorEmail?: string;
  competencia?: string;
}

export interface FiscalLista {
  documentos: FiscalDocumento[];
  total: number;
}

// ---------------------------------------------------------------------------
// Didit — verificação de identidade (KYC) de funcionários
// ---------------------------------------------------------------------------

export type StatusVerificacao =
  | 'nao_iniciada' | 'em_andamento' | 'aguardando_usuario' | 'em_revisao'
  | 'reenviada' | 'aprovada' | 'recusada' | 'expirada' | 'abandonada'
  | 'kyc_expirada' | 'desconhecido' | 'sem_verificacao';

/** GET /verificacao/minha — portão de login do funcionário autenticado. */
export interface MinhaVerificacao {
  status: StatusVerificacao;
  rotulo: string;
  url: string | null;
  /** Integração de produção habilitada + exigir_verificacao. */
  exigido: boolean;
  /** exigido && !aprovada — o guard bloqueia a navegação. */
  bloqueado: boolean;
  /** Nível 1 — pode seguir mesmo bloqueado (bypass de emergência). */
  admin: boolean;
  aprovada: boolean;
}

/** POST .../sessao — sessão hospedada criada ou reutilizada. */
export interface SessaoVerificacao {
  id: string;
  session_id: string;
  url: string;
  status: StatusVerificacao;
  rotulo: string;
  reutilizada: boolean;
}

export interface VerificacaoFuncionarioStatus {
  status: StatusVerificacao;
  rotulo: string;
  aprovada: boolean;
  terminal: boolean;
  url?: string;
  atualizado_em?: string;
}

export interface VerificacaoIdentidade {
  id: string;
  funcionario_id: number;
  session_id: string;
  url: string;
  status: StatusVerificacao;
  status_remoto: string | null;
  decidido_em: string | null;
  criado_em: string;
  atualizado_em: string;
}

export interface VerificacaoListItem {
  funcionario_nome: string;
  funcionario_nivel: number;
  verificacao: VerificacaoIdentidade;
}

// ---------------------------------------------------------------------------
// Channex (categoria 'distribuicao') — channel manager PMS → OTAs.
// ---------------------------------------------------------------------------

export interface ChannexPropriedade {
  id: string;
  title: string;
  currency: string | null;
  timezone: string | null;
}

export interface ChannexRoomType {
  id: string;
  property_id: string;
  title: string;
  occupancy: number;
  count_of_rooms: number | null;
}

export interface ChannexRatePlan {
  id: string;
  property_id: string;
  room_type_id: string;
  title: string;
  currency: string | null;
}

export interface DistAcomodacao {
  id: number;
  nome: string;
  numero: number;
  capacidade: number;
  valor: string;
}

export interface DistMapa {
  id: number;
  idacomodacao: number;
  acomodacao: string;
  numero: string | null;
  room_type_id: string;
  rate_plan_id: string;
  ativo: boolean;
  atualizado_em: string;
}

export interface DistOpcoes {
  room_types: ChannexRoomType[];
  rate_plans: ChannexRatePlan[];
  acomodacoes: DistAcomodacao[];
  mapeamentos: DistMapa[];
  property_id: string | null;
  publicacao_pausada: boolean;
}

export interface DistRevisao {
  id: number;
  revision_id: string;
  booking_id: string | null;
  ota_name: string | null;
  ota_reservation_code: string | null;
  status: string;
  inserted_at: string | null;
  aplicada: boolean;
  ack: boolean;
  erro: string | null;
  recebido_em: string;
}

export interface DistPendencia {
  id: number;
  tipo: string;
  descricao: string;
  revision_id: string | null;
  resolvida: boolean;
  criado_em: string;
}

export interface DistEnvio {
  id: number;
  tipo: string;
  task_ids: unknown;
  warnings: unknown;
  criado_em: string;
}

export interface DistResumo {
  mapeadas: number;
  sem_mapeamento: number;
  revisoes_pendentes: number;
  revisoes_sem_ack: number;
  pendencias_abertas: number;
  outbox_pendente: number;
  ultima_revisao_em: string | null;
  ultimo_envio_em: string | null;
}
