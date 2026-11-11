// Cliente HTTP tipado do domínio cms para clarituz-api.
// Chamadas passam pelo interceptor de auth (Bearer + rotação de refresh em 401).

import { Service } from '@angular/core';
import * as M from '@core/models';
import { ApiHttp } from './api-http';

@Service()
export class CmsApi extends ApiHttp {
  listarCms() {
    return this.get<M.AcomodacaoCmsView[]>('/cms/acomodacoes');
  }

  salvarCms(idacomodacao: number, input: M.CmsInput) {
    return this.put<M.AcomodacaoCms>(`/cms/acomodacoes/${idacomodacao}`, input);
  }

  statusCms(idacomodacao: number, publicar: boolean) {
    return this.patch<M.AcomodacaoCms>(`/cms/acomodacoes/${idacomodacao}/status`, { publicar });
  }

  uploadMidia(idacomodacao: number, file: File) {
    return this.http.post<M.Midia>(
      `${this.base}/cms/acomodacoes/${idacomodacao}/midia`, file,
      { headers: { 'Content-Type': file.type } },
    );
  }

  removerMidia(id: number) {
    return this.del<{ ok: boolean }>(`/cms/midia/${id}`);
  }

  definirCapa(id: number) {
    return this.patch<{ ok: boolean }>(`/cms/midia/${id}/capa`, {});
  }

  ordenarMidias(idacomodacao: number, ordem: number[]) {
    return this.patch<{ ok: boolean }>(`/cms/acomodacoes/${idacomodacao}/midia/ordem`, { ordem });
  }

  midiaAdminUrl(id: number) {
    return `${this.base}/cms/midia/${id}/arquivo`;
  }
  /** Binário autenticado da mídia — use URL.createObjectURL para preview. */

  midiaBlob(id: number) {
    return this.http.get(`${this.base}/cms/midia/${id}/arquivo`, { responseType: 'blob' });
  }

  listarSiteSecoes() {
    return this.get<M.CmsSecao[]>('/cms/site');
  }

  salvarSiteSecao(secao: string, dados: M.CmsSecaoDados) {
    return this.put<M.CmsSecao>(`/cms/site/${secao}`, dados);
  }
}
