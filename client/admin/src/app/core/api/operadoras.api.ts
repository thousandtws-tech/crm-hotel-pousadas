// Cliente HTTP tipado do domínio operadoras para clarituz-api.
// Chamadas passam pelo interceptor de auth (Bearer + rotação de refresh em 401).

import { Service } from '@angular/core';
import * as M from '@core/models';
import { ApiHttp } from './api-http';

@Service()
export class OperadorasApi extends ApiHttp {
  listarOperadoras() {
    return this.get<M.Operadora[]>('/operadoras');
  }

  criarOperadora(input: M.OperadoraInput) {
    return this.post<{ operadora: M.Operadora; token: string }>('/operadoras', input);
  }

  atualizarOperadora(id: number, input: M.OperadoraInput) {
    return this.put<M.Operadora>(`/operadoras/${id}`, input);
  }

  definirOperadoraAtiva(id: number, ativa: boolean) {
    return this.patch<M.Operadora>(`/operadoras/${id}/ativa`, { ativa });
  }

  tokenOperadora(id: number) {
    return this.get<{ token: string }>(`/operadoras/${id}/token`);
  }

  rotacionarTokenOperadora(id: number) {
    return this.post<{ token: string }>(`/operadoras/${id}/token/rotacionar`, {});
  }

  faturamentoOperadora(id: number, de: string, ate: string) {
    return this.get<M.FaturamentoOperadora>(`/operadoras/${id}/faturamento?de=${de}&ate=${ate}`);
  }
}
