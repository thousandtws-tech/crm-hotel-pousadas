// Cliente HTTP tipado do domínio estacionamento para clarituz-api.
// Chamadas passam pelo interceptor de auth (Bearer + rotação de refresh em 401).

import { Service } from '@angular/core';
import * as M from '@core/models';
import { ApiHttp } from './api-http';

@Service()
export class EstacionamentoApi extends ApiHttp {
  listarVagas() {
    return this.get<M.VagaEstacionamento[]>('/estacionamento');
  }

  criarVaga(numero: string) {
    return this.post<M.VagaEstacionamento>('/estacionamento', { numero });
  }

  vincularVaga(id: number, idacomodacao: number | null) {
    return this.patch<M.VagaEstacionamento>(`/estacionamento/${id}/vinculo`, { idacomodacao });
  }

  statusVaga(id: number, ativo: boolean) {
    return this.patch<M.VagaEstacionamento>(`/estacionamento/${id}/status`, { ativo });
  }

  removerVaga(id: number) {
    return this.del<{ mensagem: string }>(`/estacionamento/${id}`);
  }
}
