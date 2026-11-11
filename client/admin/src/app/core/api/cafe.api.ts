// Cliente HTTP tipado do domínio cafe para clarituz-api.
// Chamadas passam pelo interceptor de auth (Bearer + rotação de refresh em 401).

import { Service } from '@angular/core';
import * as M from '@core/models';
import { ApiHttp } from './api-http';

@Service()
export class CafeApi extends ApiHttp {
  quadroCafe(data?: string) {
    return this.get<M.CafeQuadroItem[]>('/cafe/quadro', { data });
  }

  registrarPresenca(idreserva: number, quantidade: number, data?: string) {
    return this.post<M.CafePresenca>('/cafe/presencas', { idreserva, quantidade, data });
  }

  removerPresenca(id: number) {
    return this.del<void>(`/cafe/presencas/${id}`);
  }

  historicoCafe(f: { inicio?: string; fim?: string; page?: number; porPagina?: number }) {
    return this.get<M.Page<M.PresencaView>>('/cafe/historico', {
      inicio: f.inicio, fim: f.fim, page: f.page, por_pagina: f.porPagina,
    });
  }
}
