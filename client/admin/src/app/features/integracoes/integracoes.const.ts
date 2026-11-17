// Rótulos PT-BR e catálogo estático dos campos de credencial por provedor.
// Os valores são WRITE-ONLY — a API só diz se cada campo está configurado.

import type {
  AmbienteIntegracao,
  EstadoIntegracao,
  ProvedorPagamento,
} from '@core/models/integracoes.models';

export const ORDEM_PROVEDOR: ProvedorPagamento[] = ['stripe', 'pagbank', 'mercadopago'];
export const ORDEM_AMBIENTE: AmbienteIntegracao[] = ['producao', 'teste'];

export const ROTULO_PROVEDOR: Record<ProvedorPagamento, string> = {
  stripe: 'Stripe',
  pagbank: 'PagBank',
  mercadopago: 'Mercado Pago',
};

export const ROTULO_AMBIENTE: Record<AmbienteIntegracao, string> = {
  producao: 'Produção',
  teste: 'Teste',
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
export const CAMPOS_POR_PROVEDOR: Record<ProvedorPagamento, CampoCredencial[]> = {
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
};

export function rotuloProvedor(p: ProvedorPagamento): string {
  return ROTULO_PROVEDOR[p] ?? p;
}

export function rotuloAmbiente(a: AmbienteIntegracao): string {
  return ROTULO_AMBIENTE[a] ?? a;
}

export function estadoDe(e: EstadoIntegracao): { rotulo: string; pill: string } {
  return ESTADO[e] ?? { rotulo: e, pill: 'pill-off' };
}
