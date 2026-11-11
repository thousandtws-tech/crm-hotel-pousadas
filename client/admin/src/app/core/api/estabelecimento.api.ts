// Cliente HTTP tipado do domínio estabelecimento para clarituz-api.
// Chamadas passam pelo interceptor de auth (Bearer + rotação de refresh em 401).

import { Service } from '@angular/core';
import * as M from '@core/models';
import { ApiHttp } from './api-http';

@Service()
export class EstabelecimentoApi extends ApiHttp {
  obterEstabelecimento() {
    return this.get<M.Estabelecimento>('/estabelecimento');
  }

  salvarEstabelecimento(input: Omit<M.Estabelecimento, 'id'>) {
    return this.put<M.Estabelecimento>('/estabelecimento', input);
  }

  obterEndereco() {
    return this.get<M.EnderecoEstabelecimento>('/estabelecimento/endereco');
  }

  salvarEndereco(input: Omit<M.EnderecoEstabelecimento, 'id'>) {
    return this.put<M.EnderecoEstabelecimento>('/estabelecimento/endereco', input);
  }

  logoAtual() {
    return this.http.get(`${this.base}/estabelecimento/logo`, { responseType: 'blob' });
  }

  uploadLogo(f: File) {
    return this.http.post(`${this.base}/estabelecimento/logo`, f, {
      headers: { 'Content-Type': f.type || 'application/octet-stream' },
    });
  }
}
