// Cliente HTTP tipado do domínio compras para clarituz-api.
// Chamadas passam pelo interceptor de auth (Bearer + rotação de refresh em 401).

import { Service } from '@angular/core';
import * as M from '@core/models';
import { ApiHttp } from './api-http';

@Service()
export class ComprasApi extends ApiHttp {
  listarFornecedores(apenasAtivos = true) {
    return this.get<M.Fornecedor[]>('/compras/fornecedores', { apenas_ativos: apenasAtivos });
  }

  salvarFornecedor(b: M.FornecedorInput) {
    return this.post<M.Fornecedor>('/compras/fornecedores', b);
  }

  statusFornecedor(id: number, ativo: boolean) {
    return this.patch<M.Fornecedor>(`/compras/fornecedores/${id}/status`, { ativo });
  }

  listarPedidos(f: { status?: string; pagina?: number } = {}) {
    return this.get<M.Page<M.PedidoCompraView>>('/compras/pedidos', { ...f, por_pagina: 15 });
  }

  buscarPedido(id: number) {
    return this.get<M.PedidoDetalhe>(`/compras/pedidos/${id}`);
  }

  criarPedido(b: M.PedidoCompraInput) {
    return this.post<M.PedidoCriado>('/compras/pedidos', b);
  }

  receberPedido(id: number, b: { itens: M.RecebimentoItem[]; observacao?: string }) {
    return this.post<{ status: string }>(`/compras/pedidos/${id}/receber`, b);
  }

  cancelarPedido(id: number) {
    return this.post<{ mensagem: string }>(`/compras/pedidos/${id}/cancelar`, {});
  }
}
