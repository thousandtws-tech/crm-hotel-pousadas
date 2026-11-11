// Cliente HTTP tipado do domínio relatorios para clarituz-api.
// Chamadas passam pelo interceptor de auth (Bearer + rotação de refresh em 401).

import { Service } from '@angular/core';
import * as M from '@core/models';
import { ApiHttp } from './api-http';

@Service()
export class RelatoriosApi extends ApiHttp {
  dashboard() {
    return this.get<M.DashboardResponse>('/dashboard');
  }

  resumoFinanceiro(inicio?: string | null, fim?: string | null) {
    return this.get<M.ResumoFinanceiro>('/financeiro/resumo', { inicio, fim });
  }

  serieRecebido(inicio?: string | null, fim?: string | null) {
    return this.get<M.PontoSerie[]>('/financeiro/series/recebido', { inicio, fim });
  }

  serieReservas(inicio?: string | null, fim?: string | null) {
    return this.get<M.PontoSerie[]>('/financeiro/series/reservas', { inicio, fim });
  }

  serieVendas(inicio?: string | null, fim?: string | null) {
    return this.get<M.PontoSerie[]>('/financeiro/series/vendas', { inicio, fim });
  }

  seriePorPagamento(inicio?: string | null, fim?: string | null) {
    return this.get<M.PontoSerie[]>('/financeiro/series/por-pagamento', { inicio, fim });
  }

  seriePorAcomodacao(inicio?: string | null, fim?: string | null) {
    return this.get<M.PontoSerie[]>('/financeiro/series/por-acomodacao', { inicio, fim });
  }

  itensMaisVendidos(inicio?: string | null, fim?: string | null) {
    return this.get<M.ItemMaisVendido[]>('/financeiro/itens-mais-vendidos', { inicio, fim });
  }

  vendasFinanceiro(inicio?: string | null, fim?: string | null) {
    return this.get<M.VendaItem[]>('/financeiro/vendas', { inicio, fim });
  }

  logs(f: {
    tabela?: string | null; acao?: string | null; idfuncionario?: number | null;
    idtabela?: number | null;
    desde?: string | null; ate?: string | null; page?: number; porPagina?: number;
  }) {
    return this.get<M.Page<M.RegistroLog>>('/auditoria/logs', {
      tabela: f.tabela, acao: f.acao, idfuncionario: f.idfuncionario,
      idtabela: f.idtabela,
      desde: f.desde, ate: f.ate, page: f.page ?? 1, por_pagina: f.porPagina ?? 50,
    });
  }

  buscaGlobal(q: string) {
    return this.get<M.ItemBusca[]>('/busca', { q });
  }
}
