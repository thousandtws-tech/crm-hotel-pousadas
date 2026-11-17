// Cliente HTTP do módulo fiscal (NFS-e via Spedy) — preparar → revisar →
// confirmar → acompanhar → cancelar → baixar documentos. A emissão é
// assíncrona: confirmar enfileira, o status vem do webhook/consulta.

import { Service } from '@angular/core';
import * as M from '@core/models';
import { ApiHttp, type Query } from './api-http';

export type FiscalFiltro = Query;

@Service()
export class FiscalApi extends ApiHttp {
  /** Gera a prévia (rascunho) da NFS-e vinculada à reserva — nada é transmitido. */
  preparar(ambiente: M.AmbienteIntegracao, idreserva: number, input: M.PrepararNfseInput) {
    return this.post<M.PreparaNfse>(`/fiscal/nfse/${ambiente}/reserva/${idreserva}/preparar`, input);
  }

  /** Confirma o rascunho — intenção durável, o worker transmite (204). */
  confirmar(iddoc: number) {
    return this.post<null>(`/fiscal/documentos/${iddoc}/confirmar`, {});
  }

  listar(filtro: FiscalFiltro = {}) {
    return this.get<M.FiscalLista>('/fiscal/documentos', filtro);
  }

  /** Documentos vinculados a uma reserva específica. */
  porReserva(idreserva: number) {
    return this.get<M.FiscalDocumento[]>(`/fiscal/reserva/${idreserva}`);
  }

  detalhe(iddoc: number) {
    return this.get<M.FiscalDocumentoView>(`/fiscal/documentos/${iddoc}`);
  }

  /** Consulta síncrona ao provedor — atualiza status se mudou. */
  sincronizar(iddoc: number) {
    return this.post<M.FiscalDocumentoView>(`/fiscal/documentos/${iddoc}/sincronizar`, {});
  }

  /** Reconciliação: reconsulta mesmo documento já terminal (auditoria). */
  reconciliar(iddoc: number) {
    return this.post<M.FiscalDocumentoView>(`/fiscal/documentos/${iddoc}/reconciliar`, {});
  }

  /** Retransmite documento rejeitado/falho após correção. */
  reprocessar(iddoc: number) {
    return this.post<M.FiscalDocumentoView>(`/fiscal/documentos/${iddoc}/reprocessar`, {});
  }

  cancelar(iddoc: number, motivo: string) {
    return this.post<M.FiscalDocumentoView>(`/fiscal/documentos/${iddoc}/cancelar`, { motivo });
  }

  /** URL do download protegido — abrir em nova aba/anchor com auth do app. */
  arquivoUrl(iddoc: number, tipo: 'pdf' | 'xml'): string {
    return `${this.base}/fiscal/documentos/${iddoc}/arquivo/${tipo}`;
  }
}
