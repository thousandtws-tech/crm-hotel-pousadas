// Cliente HTTP tipado do domínio frigobares para clarituz-api.
// Chamadas passam pelo interceptor de auth (Bearer + rotação de refresh em 401).

import { Service } from '@angular/core';
import * as M from '@core/models';
import { ApiHttp } from './api-http';

@Service()
export class FrigobaresApi extends ApiHttp {
  /** Frigobar — unidades + acomodações + itens/categorias de estoque em 1 chamada. */
  painelFrigobares() {
    return this.get<M.PainelFrigobares>('/frigobares/painel');
  }

  listarFrigobares() {
    return this.get<M.Frigobar[]>('/frigobares');
  }

  criarFrigobar(input: { idacomodacao: number; modelo?: string | null; patrimonio?: string | null }) {
    return this.post<M.Frigobar>('/frigobares', input);
  }

  atualizarFrigobar(id: number, input: { idacomodacao: number; modelo?: string | null; patrimonio?: string | null; version?: number }) {
    return this.put<M.Frigobar>(`/frigobares/${id}`, input);
  }

  statusFrigobar(id: number, ativo: boolean) {
    return this.patch<M.Frigobar>(`/frigobares/${id}/status`, { ativo });
  }

  excluirFrigobar(id: number) {
    return this.del<{ mensagem: string }>(`/frigobares/${id}`);
  }

  itensFrigobar(idfrigobar: number) {
    return this.get<M.ItemFrigobarView[]>(`/frigobares/${idfrigobar}/itens`);
  }

  reporItemFrigobar(idfrigobar: number, iditem: number, quantidade: number) {
    return this.post<M.ItemFrigobar>(`/frigobares/${idfrigobar}/itens`, { iditem, quantidade });
  }

  atualizarItemFrigobar(id: number, quantidade: number, version?: number) {
    return this.put<M.ItemFrigobar>(`/frigobares/itens/${id}`, { quantidade, version });
  }

  removerItemFrigobar(id: number) {
    return this.del<{ mensagem: string }>(`/frigobares/itens/${id}`);
  }

  statusItemFrigobar(id: number, ativo: boolean) {
    return this.patch<M.ItemFrigobar>(`/frigobares/itens/${id}/status`, { ativo });
  }
}
