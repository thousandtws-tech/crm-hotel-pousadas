// Cliente HTTP tipado do domínio financeiro para clarituz-api.
// Chamadas passam pelo interceptor de auth (Bearer + rotação de refresh em 401).

import { Service } from '@angular/core';
import * as M from '@core/models';
import { ApiHttp } from './api-http';

@Service()
export class FinanceiroApi extends ApiHttp {
  listarPlanoContas(todas = false, tipo?: M.TipoLancamento | null) {
    return this.get<M.PlanoConta[]>('/financeiro/plano-contas', { todas, tipo });
  }

  criarPlanoConta(input: {
    codigo: string; nome: string; tipo: M.TipoLancamento; grupo_dre: M.GrupoDre;
  }) {
    return this.post<M.PlanoConta>('/financeiro/plano-contas', input);
  }

  atualizarPlanoConta(id: number, input: {
    codigo: string; nome: string; tipo: M.TipoLancamento;
    grupo_dre: M.GrupoDre; version?: number;
  }) {
    return this.put<M.PlanoConta>(`/financeiro/plano-contas/${id}`, input);
  }

  statusPlanoConta(id: number, ativo: boolean) {
    return this.patch<M.PlanoConta>(`/financeiro/plano-contas/${id}/status`, { ativo });
  }

  excluirPlanoConta(id: number) {
    return this.del<{ mensagem: string }>(`/financeiro/plano-contas/${id}`);
  }

  listarContasFinanceiras(todas = false) {
    return this.get<M.ContaFinanceira[]>('/financeiro/contas', { todas });
  }

  criarContaFinanceira(input: M.ContaFinanceiraInput) {
    return this.post<M.ContaFinanceira>('/financeiro/contas', input);
  }

  atualizarContaFinanceira(id: number, input: M.ContaFinanceiraInput) {
    return this.put<M.ContaFinanceira>(`/financeiro/contas/${id}`, input);
  }

  statusContaFinanceira(id: number, ativo: boolean) {
    return this.patch<M.ContaFinanceira>(`/financeiro/contas/${id}/status`, { ativo });
  }

  saldoConta(id: number) {
    return this.get<{ saldo: string }>(`/financeiro/contas/${id}/saldo`);
  }

  listarLancamentos(f: {
    tipo?: M.TipoLancamento | null; status?: M.StatusLancamento | null;
    vencidos?: boolean; inicio?: string | null; fim?: string | null;
    idplano_conta?: number | null; busca?: string | null;
    page?: number; porPagina?: number;
  }) {
    return this.get<M.Page<M.LancamentoView>>('/financeiro/lancamentos', {
      tipo: f.tipo, status: f.status, vencidos: f.vencidos,
      inicio: f.inicio, fim: f.fim, idplano_conta: f.idplano_conta,
      busca: f.busca, page: f.page ?? 1, por_pagina: f.porPagina ?? 20,
    });
  }

  criarLancamento(input: M.LancamentoInput) {
    return this.post<M.Lancamento[]>('/financeiro/lancamentos', input);
  }

  buscarLancamento(id: number) {
    return this.get<M.Lancamento>(`/financeiro/lancamentos/${id}`);
  }

  atualizarLancamento(id: number, input: M.LancamentoInput) {
    return this.put<M.Lancamento>(`/financeiro/lancamentos/${id}`, input);
  }

  cancelarLancamento(id: number) {
    return this.post<M.Lancamento>(`/financeiro/lancamentos/${id}/cancelar`, {});
  }

  excluirLancamento(id: number) {
    return this.del<{ mensagem: string }>(`/financeiro/lancamentos/${id}`);
  }

  baixarLancamento(id: number, input: M.BaixaInput) {
    return this.post<M.BaixaResponse>(`/financeiro/lancamentos/${id}/baixar`, input);
  }

  listarBaixas(idlancamento: number) {
    return this.get<M.BaixaView[]>(`/financeiro/lancamentos/${idlancamento}/baixas`);
  }

  fluxoCaixa(inicio?: string | null, fim?: string | null) {
    return this.get<M.FluxoCaixa>('/financeiro/fluxo-caixa', { inicio, fim });
  }

  dre(inicio?: string | null, fim?: string | null) {
    return this.get<M.Dre>('/financeiro/dre', { inicio, fim });
  }

  listarExtrato(f: {
    idconta_financeira?: number | null; status?: M.StatusExtrato | null;
    inicio?: string | null; fim?: string | null;
    page?: number; porPagina?: number;
  }) {
    return this.get<M.Page<M.ExtratoView>>('/financeiro/extrato', {
      idconta_financeira: f.idconta_financeira, status: f.status,
      inicio: f.inicio, fim: f.fim,
      page: f.page ?? 1, por_pagina: f.porPagina ?? 30,
    });
  }

  resumoExtrato(idconta_financeira?: number | null) {
    return this.get<M.ConciliacaoResumo>('/financeiro/extrato/resumo', {
      idconta_financeira,
    });
  }

  importarExtrato(idconta_financeira: number, conteudo: string) {
    return this.post<{ importados: number; duplicados: number }>(
      '/financeiro/extrato', { idconta_financeira, conteudo },
    );
  }

  ignorarExtrato(id: number) {
    return this.post<{ mensagem: string }>(`/financeiro/extrato/${id}/ignorar`, {});
  }

  sugestoesExtrato(id: number) {
    return this.get<M.SugestaoConciliacao[]>(`/financeiro/extrato/${id}/sugestoes`);
  }

  conciliarExtrato(id: number, idbaixa: number) {
    return this.post<M.Conciliacao>(`/financeiro/extrato/${id}/conciliar`, { idbaixa });
  }

  classificarExtrato(id: number, idplano_conta: number, descricao?: string | null) {
    return this.post<M.Lancamento>(`/financeiro/extrato/${id}/classificar`, {
      idplano_conta, descricao,
    });
  }

  desconciliar(idconciliacao: number) {
    return this.del<{ mensagem: string }>(`/financeiro/conciliacoes/${idconciliacao}`);
  }

  autoConciliar(idconta: number) {
    return this.post<{ conciliados: number }>(
      `/financeiro/conciliar-auto/${idconta}`, {},
    );
  }

  tributoConfig() {
    return this.get<M.TributoConfig | null>('/financeiro/tributos');
  }

  listarTributoConfigs() {
    return this.get<M.TributoConfig[]>('/financeiro/tributos/historico');
  }

  criarTributoConfig(input: {
    aliq_ibs: number; aliq_cbs: number; regime?: string; vigente_desde?: string | null;
  }) {
    return this.post<M.TributoConfig>('/financeiro/tributos', input);
  }

  splitResumo(inicio?: string | null, fim?: string | null) {
    return this.get<M.SplitResumo>('/financeiro/split/resumo', { inicio, fim });
  }

  splitEventos(inicio?: string | null, fim?: string | null, page = 1, porPagina = 20) {
    return this.get<M.Page<M.SplitEventoView>>('/financeiro/split/eventos', {
      inicio, fim, page, por_pagina: porPagina,
    });
  }

  listarApuracoes() {
    return this.get<M.TributoApuracao[]>('/financeiro/apuracoes');
  }

  recolherApuracao(competencia: string) {
    return this.post<M.TributoApuracao>('/financeiro/apuracoes/recolher', { competencia });
  }
}
