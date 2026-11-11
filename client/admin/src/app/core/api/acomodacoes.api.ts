// Cliente HTTP tipado do domínio acomodacoes para clarituz-api.
// Chamadas passam pelo interceptor de auth (Bearer + rotação de refresh em 401).

import { Service } from '@angular/core';
import * as M from '@core/models';
import { ApiHttp } from './api-http';

@Service()
export class AcomodacoesApi extends ApiHttp {
  listarTipos(apenasAtivos = false) {
    return this.get<M.TipoAcomodacao[]>('/tipos-acomodacao', { apenas_ativos: apenasAtivos });
  }

  criarTipo(nome: string) {
    return this.post<M.TipoAcomodacao>('/tipos-acomodacao', { nome });
  }

  atualizarTipo(id: number, nome: string, version?: number) {
    return this.put<M.TipoAcomodacao>(`/tipos-acomodacao/${id}`, { nome, version });
  }

  statusTipo(id: number, ativo: boolean) {
    return this.patch<M.TipoAcomodacao>(`/tipos-acomodacao/${id}/status`, { ativo });
  }

  excluirTipo(id: number) {
    return this.del<{ mensagem: string }>(`/tipos-acomodacao/${id}`);
  }

  tarifasOcupacao(idtipo: number) {
    return this.get<M.TarifaOcupacao[]>(`/tipos-acomodacao/${idtipo}/tarifas-ocupacao`);
  }

  salvarTarifasOcupacao(idtipo: number, faixas: M.TarifaOcupacaoInput[]) {
    return this.put<M.TarifaOcupacao[]>(`/tipos-acomodacao/${idtipo}/tarifas-ocupacao`, faixas);
  }

  listarAcomodacoes(page = 1, porPagina = 50, apenasAtivas = false) {
    return this.get<M.Page<M.Acomodacao>>('/acomodacoes', {
      page, por_pagina: porPagina, apenas_ativas: apenasAtivas,
    });
  }

  buscarAcomodacao(id: number) {
    return this.get<M.Acomodacao>(`/acomodacoes/${id}`);
  }

  criarAcomodacao(input: M.AcomodacaoInput) {
    return this.post<M.Acomodacao>('/acomodacoes', input);
  }

  atualizarAcomodacao(id: number, input: M.AcomodacaoInput) {
    return this.put<M.Acomodacao>(`/acomodacoes/${id}`, input);
  }

  statusAcomodacao(id: number, ativo: boolean) {
    return this.patch<M.Acomodacao>(`/acomodacoes/${id}/status`, { ativo });
  }

  excluirAcomodacao(id: number) {
    return this.del<{ mensagem: string }>(`/acomodacoes/${id}`);
  }

  tarifasAcomodacao(id: number) {
    return this.get<M.TarifaHistorico[]>(`/acomodacoes/${id}/tarifas`);
  }

  listarQuartos(idacomodacao: number) {
    return this.get<M.Quarto[]>(`/acomodacoes/${idacomodacao}/quartos`);
  }

  criarQuarto(idacomodacao: number, numero: string) {
    return this.post<M.Quarto>(`/acomodacoes/${idacomodacao}/quartos`, { numero });
  }

  statusQuarto(id: number, ativo: boolean) {
    return this.patch<M.Quarto>(`/quartos/${id}/status`, { ativo });
  }

  excluirQuarto(id: number) {
    return this.del<{ mensagem: string }>(`/quartos/${id}`);
  }
}
