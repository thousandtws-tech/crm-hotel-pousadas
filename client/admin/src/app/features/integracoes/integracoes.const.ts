// Rótulos PT-BR e catálogo estático dos campos de credencial por provedor.
// Os valores são WRITE-ONLY — a API só diz se cada campo está configurado.

import type {
  AmbienteIntegracao,
  CategoriaIntegracao,
  EstadoIntegracao,
  IntegracaoView,
  ProvedorIntegracao,
  ZapiSessao,
} from '@core/models/integracoes.models';

export const ORDEM_PROVEDOR: ProvedorIntegracao[] = ['stripe', 'pagbank', 'mercadopago', 'zapi'];
export const ORDEM_AMBIENTE: AmbienteIntegracao[] = ['producao', 'teste'];

export const ROTULO_PROVEDOR: Record<ProvedorIntegracao, string> = {
  stripe: 'Stripe',
  pagbank: 'PagBank',
  mercadopago: 'Mercado Pago',
  zapi: 'Z-API',
};

export const ROTULO_AMBIENTE: Record<AmbienteIntegracao, string> = {
  producao: 'Produção',
  teste: 'Teste',
};

/** Agrupamento do catálogo — pagamentos primeiro, comunicação depois. */
export const ORDEM_CATEGORIA: CategoriaIntegracao[] = ['pagamento', 'comunicacao'];

export const ROTULO_CATEGORIA: Record<CategoriaIntegracao, string> = {
  pagamento: 'Pagamentos',
  comunicacao: 'Comunicação',
};

/** Categoria estática por provedor — igual à regra do backend. */
export const CATEGORIA_PROVEDOR: Record<ProvedorIntegracao, CategoriaIntegracao> = {
  stripe: 'pagamento',
  pagbank: 'pagamento',
  mercadopago: 'pagamento',
  zapi: 'comunicacao',
};

/** estado → rótulo + variante de pill (semântica, sem cor arbitrária). */
export const ESTADO: Record<EstadoIntegracao, { rotulo: string; pill: string }> = {
  ativa: { rotulo: 'Ativa', pill: 'pill-ok' },
  pendente: { rotulo: 'Pendente', pill: 'pill-warn' },
  falha: { rotulo: 'Falha na verificação', pill: 'pill-erro' },
  desativada: { rotulo: 'Desativada', pill: 'pill-off' },
  gerenciado_pelo_ambiente: {
    rotulo: 'Gerenciada pelo ambiente',
    pill: 'pill-info',
  },
  nao_configurada: { rotulo: 'Não configurada', pill: 'pill-off' },
};

export const ROTULO_EVENTO: Record<string, { rotulo: string; pill: string }> = {
  recebido: { rotulo: 'Recebido', pill: 'pill-info' },
  processado: { rotulo: 'Processado', pill: 'pill-ok' },
  falhou: { rotulo: 'Falhou', pill: 'pill-erro' },
  ignorado: { rotulo: 'Ignorado', pill: 'pill-off' },
};

/** Tipos de callback da Z-API (`event_type` dos eventos) → rótulo amigável. */
export const ROTULO_EVENTO_ZAPI: Record<string, string> = {
  ReceivedCallback: 'Mensagem recebida',
  DeliveryCallback: 'Entrega confirmada',
  MessageStatusCallback: 'Status da mensagem',
  ConnectedCallback: 'Sessão conectada',
  DisconnectedCallback: 'Sessão desconectada',
};

export interface CampoCredencial {
  nome: string;
  rotulo: string;
  /** segredo → type=password + nunca exibido; público → texto normal. */
  segredo: boolean;
  obrigatorio?: boolean;
  dica?: string;
  placeholder?: string;
}

/** Campos de credencial por provedor — catálogo estático, valores write-only. */
export const CAMPOS_POR_PROVEDOR: Record<ProvedorIntegracao, CampoCredencial[]> = {
  stripe: [
    {
      nome: 'secret_key',
      rotulo: 'Secret key',
      segredo: true,
      obrigatorio: true,
      placeholder: 'sk_live_…',
    },
    {
      nome: 'webhook_secret',
      rotulo: 'Webhook signing secret',
      segredo: true,
      dica: 'Obrigatório para receber eventos via webhook',
      placeholder: 'whsec_…',
    },
    {
      nome: 'public_key',
      rotulo: 'Publishable key',
      segredo: false,
      placeholder: 'pk_live_…',
    },
  ],
  pagbank: [
    {
      nome: 'access_token',
      rotulo: 'Access token',
      segredo: true,
      obrigatorio: true,
    },
    {
      nome: 'authenticity_token',
      rotulo: 'Authenticity token',
      segredo: true,
      dica: 'Validação da assinatura dos webhooks',
    },
  ],
  mercadopago: [
    {
      nome: 'access_token',
      rotulo: 'Access token',
      segredo: true,
      obrigatorio: true,
      placeholder: 'APP_USR-…',
    },
    {
      nome: 'webhook_secret',
      rotulo: 'Webhook secret',
      segredo: true,
      dica: 'Obrigatório para receber eventos via webhook',
    },
    {
      nome: 'public_key',
      rotulo: 'Public key',
      segredo: false,
      placeholder: 'APP_USR-…',
    },
  ],
  // `webhook_segredo` não aparece aqui: o backend o gera automaticamente
  // na primeira gravação — a tela dedicada o exibe como somente-leitura.
  zapi: [
    {
      nome: 'instance_token',
      rotulo: 'Instance token',
      segredo: true,
      obrigatorio: true,
      dica: 'Token da instância no painel Z-API',
    },
    {
      nome: 'client_token',
      rotulo: 'Client token',
      segredo: true,
      obrigatorio: true,
      dica: 'Token de segurança da conta (Client-Token)',
    },
  ],
};

export function rotuloProvedor(p: ProvedorIntegracao): string {
  return ROTULO_PROVEDOR[p] ?? p;
}

export function rotuloAmbiente(a: AmbienteIntegracao): string {
  return ROTULO_AMBIENTE[a] ?? a;
}

export function estadoDe(e: EstadoIntegracao): { rotulo: string; pill: string } {
  return ESTADO[e] ?? { rotulo: e, pill: 'pill-off' };
}

// ---------------------------------------------------------------------------
// Z-API — leituras tipadas da `config` não-secreta.
// ---------------------------------------------------------------------------

/** `config.sessao` — null quando a sessão nunca foi observada. */
export function sessaoZapi(i: IntegracaoView): ZapiSessao | null {
  const s = i.config?.['sessao'];
  return s !== null && typeof s === 'object' ? (s as ZapiSessao) : null;
}

/** `config.instance_id` — identificador público da instância. */
export function instanceIdZapi(i: IntegracaoView): string {
  const v = i.config?.['instance_id'];
  return typeof v === 'string' ? v : '';
}

/** `config.webhooks_configurados` — callbacks já registrados na instância. */
export function webhooksConfigurados(i: IntegracaoView): number {
  const v = i.config?.['webhooks_configurados'];
  return typeof v === 'number' ? v : 0;
}

/** Callbacks que "Configurar webhooks" registra — da `capabilities` da API. */
export function callbacksEsperados(i: IntegracaoView): number {
  const v = i.capabilities?.['callbacks'];
  return Array.isArray(v) ? v.length : 5;
}

export function rotuloEventoZapi(tipo: string): string {
  return ROTULO_EVENTO_ZAPI[tipo] ?? tipo;
}
