// Cliente HTTP tipado do domínio comunicacao para clarituz-api.
// Chamadas passam pelo interceptor de auth (Bearer + rotação de refresh em 401).

import { Service } from '@angular/core';
import * as M from '@core/models';
import { ApiHttp } from './api-http';

@Service()
export class ComunicacaoApi extends ApiHttp {
  listarComissoes(f: {
    idgarcom?: number | null; apenasPendentes?: boolean;
    inicio?: string | null; fim?: string | null; page?: number; porPagina?: number;
  }) {
    return this.get<M.Page<M.ComissaoView>>('/pdv/comissoes', {
      idgarcom: f.idgarcom, apenas_pendentes: f.apenasPendentes,
      inicio: f.inicio, fim: f.fim,
      page: f.page ?? 1, por_pagina: f.porPagina ?? 50,
    });
  }
  // -- comunicação / reputação --------------------------------------------------

  filaEnvio() {
    return this.get<M.ItemFila[]>('/comunicacao/fila');
  }

  matrizNotificacao() {
    return this.get<M.RegraMatriz[]>('/comunicacao/matriz');
  }

  gravarRegraMatriz(regra: M.RegraMatriz) {
    return this.post<void>('/comunicacao/matriz', regra);
  }

  dispararCobranca(idreserva: number) {
    return this.post<void>(`/comunicacao/cobranca/${idreserva}`, {});
  }

  avaliacoes(status?: string) {
    return this.get<M.Avaliacao[]>('/avaliacoes', { status });
  }

  avaliacoesDashboard() {
    return this.get<M.AvaliacoesDash>('/avaliacoes/dashboard');
  }

  responderAvaliacao(id: number, resposta: string) {
    return this.post<void>(`/avaliacoes/${id}/responder`, { resposta });
  }

  fidelidadeNiveis() {
    return this.get<M.NivelFidelidade[]>('/fidelidade/niveis');
  }
  // -- LGPD ---------------------------------------------------------------------

  lgpdSolicitacoes(status?: string) {
    return this.get<M.LgpdSolicitacao[]>('/lgpd/solicitacoes', { status });
  }

  lgpdResponder(id: number, resposta: string) {
    return this.post<void>(`/lgpd/solicitacoes/${id}/responder`, { resposta });
  }

  atendimentos(status?: string, setor?: string) {
    return this.get<M.Atendimento[]>('/atendimentos', { status, setor });
  }

  atendAceitar(id: number) {
    return this.post<M.Atendimento>(`/atendimentos/${id}/aceitar`, {});
  }

  atendResolver(id: number) {
    return this.post<M.Atendimento>(`/atendimentos/${id}/resolver`, {});
  }

  pushVapidKey() {
    return this.get<{ publica: string }>('/push/vapid-key');
  }

  pushSubscribe(sub: { endpoint: string; p256dh: string; auth: string; user_agent?: string }) {
    return this.post<void>('/push/subscribe', sub);
  }

  pushUnsubscribe(endpoint: string) {
    return this.post<void>('/push/unsubscribe', { endpoint });
  }
}
