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

  // -----------------------------------------------------------------------
  // Infobip — SMS transacional; `ambiente` deve ser 'producao'.
  // -----------------------------------------------------------------------

  /** SMS de teste único — destinatário preso à allowlist da config. */
  infobipTeste(ambiente: M.AmbienteIntegracao, input: M.InfobipTesteInput) {
    return this.post<M.InfobipTesteResultado>(`/integracoes/infobip/${ambiente}/teste-msg`, input);
  }

  // -----------------------------------------------------------------------
  // Spedy — configuração da empresa/município/webhook (categoria 'fiscal').
  // -----------------------------------------------------------------------

  /** Consulta/vincula a empresa da X-Api-Key configurada. */
  spedyEmpresa(ambiente: M.AmbienteIntegracao) {
    return this.post<M.SpedyEmpresa>(`/integracoes/spedy/${ambiente}/empresa`, {});
  }

  /** Provedores e obrigatoriedades do município de emissão (código IBGE). */
  spedyMunicipio(ambiente: M.AmbienteIntegracao, ibge: string) {
    return this.get<M.SpedyMunicipioSettings>(`/integracoes/spedy/${ambiente}/municipio/${ibge}`);
  }

  /** Settings fiscais atuais da empresa remota. */
  spedySettings(ambiente: M.AmbienteIntegracao) {
    return this.get<M.SpedyEmpresaSettings>(`/integracoes/spedy/${ambiente}/settings`);
  }

  /** Registra o webhook na empresa remota — devolve a URL configurada. */
  spedyConfigurarWebhook(ambiente: M.AmbienteIntegracao) {
    return this.post<{ webhook_url: string }>(`/integracoes/spedy/${ambiente}/webhook`, {});
  }

  // -- Channex (distribuição) ---------------------------------------------

  distPropriedades(ambiente: M.AmbienteIntegracao) {
    return this.get<{ data: M.ChannexPropriedade[] }>(`/distribuicao/${ambiente}/propriedades`);
  }

  distVincular(ambiente: M.AmbienteIntegracao, property_id: string) {
    return this.post<null>(`/distribuicao/${ambiente}/propriedade`, { property_id });
  }

  distOpcoes(ambiente: M.AmbienteIntegracao) {
    return this.get<{ data: M.DistOpcoes }>(`/distribuicao/${ambiente}/opcoes`);
  }

  distMapear(
    ambiente: M.AmbienteIntegracao,
    idacomodacao: number,
    room_type_id: string,
    rate_plan_id: string,
  ) {
    return this.post<null>(`/distribuicao/${ambiente}/mapeamentos`, {
      idacomodacao,
      room_type_id,
      rate_plan_id,
    });
  }

  distDesmapear(ambiente: M.AmbienteIntegracao, id: number) {
    return this.del<null>(`/distribuicao/${ambiente}/mapeamentos/${id}`);
  }

  distSincronizar(ambiente: M.AmbienteIntegracao, inicio: string, fim: string) {
    return this.post<{ enfileirados: number }>(`/distribuicao/${ambiente}/sincronizar`, {
      inicio,
      fim,
    });
  }

  distReconciliar(ambiente: M.AmbienteIntegracao) {
    return this.post<{ enfileirados: number }>(`/distribuicao/${ambiente}/reconciliar`, {});
  }

  distPausar(ambiente: M.AmbienteIntegracao, pausada: boolean) {
    return this.post<null>(`/distribuicao/${ambiente}/publicacao`, { pausada });
  }

  distRevisoes(ambiente: M.AmbienteIntegracao) {
    return this.get<{ data: M.DistRevisao[] }>(`/distribuicao/${ambiente}/revisoes`);
  }

  distPendencias(ambiente: M.AmbienteIntegracao) {
    return this.get<{ data: M.DistPendencia[] }>(`/distribuicao/${ambiente}/pendencias`);
  }

  distResolverPendencia(ambiente: M.AmbienteIntegracao, id: number) {
    return this.post<null>(`/distribuicao/${ambiente}/pendencias/${id}/resolver`, {});
  }

  distReprocessar(ambiente: M.AmbienteIntegracao, revision_id: string) {
    return this.post<null>(`/distribuicao/${ambiente}/revisoes/${revision_id}/reprocessar`, {});
  }

  distResumo(ambiente: M.AmbienteIntegracao) {
    return this.get<{ data: M.DistResumo }>(`/distribuicao/${ambiente}/resumo`);
  }

  distRegistrarWebhook(ambiente: M.AmbienteIntegracao) {
    return this.post<{ webhook_url: string }>(`/distribuicao/${ambiente}/webhook`, {});
  }
}
