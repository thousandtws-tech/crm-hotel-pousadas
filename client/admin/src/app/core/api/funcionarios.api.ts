// Cliente HTTP tipado do domínio funcionarios para clarituz-api.
// Chamadas passam pelo interceptor de auth (Bearer + rotação de refresh em 401).

import { Service } from '@angular/core';
import * as M from '@core/models';
import { ApiHttp } from './api-http';

@Service()
export class FuncionariosApi extends ApiHttp {
  listarFuncionarios(page = 1, porPagina = 20, apenasAtivos = false) {
    return this.get<M.Page<M.Funcionario>>('/funcionarios', {
      page, por_pagina: porPagina, apenas_ativos: apenasAtivos,
    });
  }

  criarFuncionario(input: M.FuncionarioInput) {
    return this.post<M.Funcionario>('/funcionarios', input);
  }

  atualizarFuncionario(id: number, input: M.FuncionarioUpdate) {
    return this.put<M.Funcionario>(`/funcionarios/${id}`, input);
  }

  statusFuncionario(id: number, ativo: boolean) {
    return this.patch<M.Funcionario>(`/funcionarios/${id}/status`, { ativo });
  }

  excluirFuncionario(id: number) {
    return this.del<void>(`/funcionarios/${id}`);
  }
}
