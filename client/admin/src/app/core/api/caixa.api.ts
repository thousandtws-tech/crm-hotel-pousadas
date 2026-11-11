// Cliente HTTP tipado do domínio caixa para clarituz-api.
// Chamadas passam pelo interceptor de auth (Bearer + rotação de refresh em 401).

import { Service } from '@angular/core';
import * as M from '@core/models';
import { ApiHttp } from './api-http';

@Service()
export class CaixaApi extends ApiHttp {
  turnoAberto(idconta_financeira: number) {
    return this.get<M.CaixaTurno | null>('/financeiro/caixa/aberto', {
      idconta_financeira,
    });
  }

  listarTurnos(f: {
    idconta_financeira?: number;
    status?: M.StatusTurno;
    idoperador?: number;
    inicio?: string;
    fim?: string;
    page?: number;
    porPagina?: number;
  }) {
    return this.get<M.Page<M.TurnoView>>('/financeiro/caixa/turnos', {
      idconta_financeira: f.idconta_financeira,
      status: f.status,
      idoperador: f.idoperador,
      inicio: f.inicio,
      fim: f.fim,
      page: f.page ?? 1,
      por_pagina: f.porPagina ?? 20,
    });
  }

  abrirTurno(input: M.AbrirCaixaInput) {
    return this.post<M.CaixaTurno>('/financeiro/caixa/turnos', input);
  }

  buscarTurno(id: number) {
    return this.get<M.TurnoView>(`/financeiro/caixa/turnos/${id}`);
  }

  conferirTurno(id: number) {
    return this.get<M.ConferenciaCaixa>(`/financeiro/caixa/turnos/${id}/conferencia`);
  }

  listarMovimentosTurno(id: number) {
    return this.get<M.MovimentoCaixaView[]>(`/financeiro/caixa/turnos/${id}/movimentos`);
  }

  movimentarTurno(id: number, input: M.MovCaixaInput) {
    return this.post<M.CaixaMovimento>(`/financeiro/caixa/turnos/${id}/movimentos`, input);
  }

  fecharTurno(id: number, input: M.FecharCaixaInput) {
    return this.post<M.CaixaTurno>(`/financeiro/caixa/turnos/${id}/fechar`, input);
  }
}
