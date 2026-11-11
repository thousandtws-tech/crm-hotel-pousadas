// Cliente HTTP tipado do domínio notificacoes para clarituz-api.
// Chamadas passam pelo interceptor de auth (Bearer + rotação de refresh em 401).

import { Service } from '@angular/core';
import * as M from '@core/models';
import { ApiHttp } from './api-http';

@Service()
export class NotificacoesApi extends ApiHttp {
  notificacoes(page = 1, porPagina = 30) {
    return this.get<M.Page<M.Notificacao>>('/notificacoes', { page, por_pagina: porPagina });
  }

  naoLidas() {
    return this.get<{ total: number }>('/notificacoes/nao-lidas');
  }

  lerNotificacao(id: number) {
    return this.post<{ ok: boolean }>(`/notificacoes/${id}/ler`, {});
  }

  lerTodasNotificacoes() {
    return this.post<{ ok: boolean; marcadas: number }>('/notificacoes/ler-todas', {});
  }

  excluirNotificacao(id: number) {
    return this.del<{ ok: boolean }>(`/notificacoes/${id}`);
  }
}
