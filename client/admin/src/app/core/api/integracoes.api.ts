// Cliente HTTP das integrações — catálogo (provedor × ambiente), credenciais
// write-only, habilitação, teste ao vivo, padrão por escopo e eventos de
// webhook. Rotas admin-only no backend; a UI já passa pelo adminGuard.
// Z-API (categoria 'comunicacao') tem ações próprias — sempre `producao`.

import { Service } from '@angular/core';
import * as M from '@core/models';
import { ApiHttp } from './api-http';

@Service()
export class IntegracoesApi extends ApiHttp {
  /** Catálogo completo — inclui pares ainda não configurados. */
  listar() {
    return this.get<M.IntegracaoView[]>('/integracoes');
  }

  buscar(provedor: M.ProvedorIntegracao, ambiente: M.AmbienteIntegracao) {
    return this.get<M.IntegracaoView>(`/integracoes/${provedor}/${ambiente}`);
  }

  /** `segredos`: campo presente substitui, `""` remove, ausente mantém. */
  salvar(provedor: M.ProvedorIntegracao, ambiente: M.AmbienteIntegracao, input: M.IntegracaoInput) {
    return this.put<M.IntegracaoView>(`/integracoes/${provedor}/${ambiente}`, input);
  }

  habilitacao(provedor: M.ProvedorIntegracao, ambiente: M.AmbienteIntegracao, habilitado: boolean) {
    return this.patch<M.IntegracaoView>(`/integracoes/${provedor}/${ambiente}/habilitacao`, {
      habilitado,
    });
  }

  testar(provedor: M.ProvedorIntegracao, ambiente: M.AmbienteIntegracao) {
    return this.post<M.TesteIntegracao>(`/integracoes/${provedor}/${ambiente}/testar`, {});
  }

  /** Define o par como padrão do escopo — site (pagamento) ou whatsapp (204). */
  definirPadrao(provedor: M.ProvedorIntegracao, ambiente: M.AmbienteIntegracao) {
    return this.put<null>(`/integracoes/${provedor}/${ambiente}/padrao`, {});
  }

  /** Últimos 50 eventos de webhook recebidos pelo par. */
  eventos(provedor: M.ProvedorIntegracao, ambiente: M.AmbienteIntegracao) {
    return this.get<M.EventoIntegracaoView[]>(`/integracoes/${provedor}/${ambiente}/eventos`);
  }

  // -----------------------------------------------------------------------
  // Z-API — operações da instância; `ambiente` deve ser 'producao'.
  // -----------------------------------------------------------------------

  /** QR Code de pareamento — imagem base64 ou fluxo assistido. */
  qrCode(ambiente: M.AmbienteIntegracao) {
    return this.post<M.ZapiQrCode>(`/integracoes/zapi/${ambiente}/qr-code`, {});
  }

  /** Registra os callbacks da instância na URL pública do provedor. */
  configurarWebhooks(ambiente: M.AmbienteIntegracao) {
    return this.post<M.ZapiWebhooksResultado>(`/integracoes/zapi/${ambiente}/webhooks`, {});
  }

  /** Mensagem de teste única — destinatário explícito, sem retry. */
  enviarTeste(ambiente: M.AmbienteIntegracao, input: M.ZapiTesteInput) {
    return this.post<M.ZapiTesteResultado>(`/integracoes/zapi/${ambiente}/teste-msg`, input);
  }

  /** Logout remoto da sessão (204) — não apaga as credenciais. */
  desconectar(ambiente: M.AmbienteIntegracao) {
    return this.post<null>(`/integracoes/zapi/${ambiente}/desconectar`, {});
  }
}
