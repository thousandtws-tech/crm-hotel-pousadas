// Cliente HTTP tipado do domínio contratos para clarituz-api.
// Chamadas passam pelo interceptor de auth (Bearer + rotação de refresh em 401).

import { Service } from '@angular/core';
import * as M from '@core/models';
import { ApiHttp } from './api-http';

@Service()
export class ContratosApi extends ApiHttp {
  listarContratos() {
    return this.get<M.ContratoCorporativo[]>('/contratos');
  }

  criarContrato(input: M.ContratoInput) {
    return this.post<M.ContratoCorporativo>('/contratos', input);
  }

  atualizarContrato(id: number, input: M.ContratoInput) {
    return this.put<M.ContratoCorporativo>(`/contratos/${id}`, input);
  }

  definirContratoAtivo(id: number, ativo: boolean) {
    return this.patch<M.ContratoCorporativo>(`/contratos/${id}/ativo`, { ativo });
  }
}
