// Cliente HTTP tipado do domínio pagamentos para clarituz-api.
// Chamadas passam pelo interceptor de auth (Bearer + rotação de refresh em 401).

import { Service } from '@angular/core';
import * as M from '@core/models';
import { ApiHttp } from './api-http';

@Service()
export class PagamentosApi extends ApiHttp {
  listarPagamentos(apenasAtivos = true) {
    return this.get<M.FormaPagamento[]>('/formas-pagamento', {
      apenas_ativos: apenasAtivos,
    });
  }

  criarPagamento(nome: string) {
    return this.post<M.FormaPagamento>('/formas-pagamento', { nome });
  }

  atualizarPagamento(id: number, nome: string, version?: number) {
    return this.put<M.FormaPagamento>(`/formas-pagamento/${id}`, { nome, version });
  }

  statusPagamento(id: number, ativo: boolean) {
    return this.patch<M.FormaPagamento>(`/formas-pagamento/${id}/status`, { ativo });
  }

  excluirPagamento(id: number) {
    return this.del<{ mensagem: string }>(`/formas-pagamento/${id}`);
  }

  comprovantes() {
    return this.get<M.ComprovanteResumo[]>('/pagamentos/comprovantes');
  }

  pagamentosOnline(f: { status?: string; idreserva?: number; inicio?: string; fim?: string; per_page?: number; page?: number }) {
    return this.get<{ items: M.PagOnlineResumo[]; total: number }>('/pagamentos', f);
  }

  resumoFinanceiroOnline(inicio?: string, fim?: string) {
    return this.get<M.ResumoFinanceiroOnline>('/financeiro/pagamentos/resumo', { inicio, fim });
  }

  receitaPorAcomodacao(inicio?: string, fim?: string) {
    return this.get<M.ReceitaAcomodacao[]>('/financeiro/pagamentos/receita-acomodacoes', { inicio, fim });
  }

  pagamentosDaReserva(idreserva: number) {
    return this.get<M.PagOnlineResumo[]>(`/reservas/${idreserva}/pagamentos`);
  }

  reembolsarPagamento(id: number, valorCentavos: number | null, motivo: string) {
    return this.post<{ idreembolso: number }>(`/pagamentos/${id}/reembolsos`, {
      valor_centavos: valorCentavos,
      motivo: motivo || null,
    });
  }

  comprovanteTexto(idreserva: number) {
    return this.http.get(`${this.base}/pagamentos/comprovantes/${idreserva}`, {
      responseType: 'text',
    });
  }
  // -- impressoras por setor ---------------------------------------------------
}
