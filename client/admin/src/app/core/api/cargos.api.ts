// Cliente HTTP tipado do domínio cargos para clarituz-api.
// Chamadas passam pelo interceptor de auth (Bearer + rotação de refresh em 401).

import { Service } from '@angular/core';
import { Cargo, CargoInput, CargoUpdate } from '@core/models';
import { ApiHttp } from './api-http';

@Service()
export class CargosApi extends ApiHttp {
  listar(apenasAtivos = false) {
    return this.get<Cargo[]>('/cargos', { apenas_ativos: apenasAtivos });
  }

  criar(input: CargoInput) {
    return this.post<Cargo>('/cargos', input);
  }

  atualizar(id: number, input: CargoUpdate) {
    return this.put<Cargo>(`/cargos/${id}`, input);
  }

  excluir(id: number) {
    return this.del<void>(`/cargos/${id}`);
  }
}
