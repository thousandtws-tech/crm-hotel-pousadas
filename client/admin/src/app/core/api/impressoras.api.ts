// Cliente HTTP tipado do domínio impressoras para clarituz-api.
// Chamadas passam pelo interceptor de auth (Bearer + rotação de refresh em 401).

import { Service } from '@angular/core';
import * as M from '@core/models';
import { ApiHttp } from './api-http';

@Service()
export class ImpressorasApi extends ApiHttp {
  listarImpressoras() {
    return this.get<M.Impressora[]>('/impressoras');
  }

  criarImpressora(input: Omit<M.Impressora, 'id' | 'criado_em' | 'version'>) {
    return this.post<M.Impressora>('/impressoras', input);
  }

  atualizarImpressora(id: number, input: Omit<M.Impressora, 'id' | 'criado_em' | 'version'> & { version?: number }) {
    return this.put<M.Impressora>(`/impressoras/${id}`, input);
  }

  statusImpressora(id: number, ativo: boolean) {
    return this.patch(`/impressoras/${id}/status`, { ativo });
  }

  removerImpressora(id: number) {
    return this.del(`/impressoras/${id}`);
  }
  /** Reimprime a etiqueta do item na impressora dedicada. */

  etiquetaItem(id: number) {
    return this.post(`/estoque/itens/${id}/etiqueta`, {});
  }

  testarImpressora(id: number) {
    return this.post(`/impressoras/${id}/testar`, {});
  }

  listarDescobertasImpressoras() {
    return this.get<M.ImpressoraDescoberta[]>('/impressoras/descobertas');
  }

  registrarDescoberta(id: number, body: { nome: string; setor: string; padrao?: boolean; etiqueta?: boolean }) {
    return this.post<M.Impressora>(`/impressoras/descobertas/${id}/registrar`, body);
  }

  ignorarDescoberta(id: number) {
    return this.del(`/impressoras/descobertas/${id}`);
  }
  /** Reimprime tickets de produção (KOT) do consumo da reserva. */

  imprimirProducao(idreserva: number) {
    return this.post<{ mensagem: string; tickets: number }>(
      `/reservas/${idreserva}/consumo/imprimir`,
      {},
    );
  }

  imprimirComprovante(idreserva: number, impressora?: number) {
    const qs = impressora ? `?impressora=${impressora}` : '';
    return this.post<{ mensagem: string }>(
      `/pagamentos/comprovantes/${idreserva}/imprimir${qs}`,
      {},
    );
  }
}
