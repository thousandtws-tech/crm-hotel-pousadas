// Cliente HTTP tipado do domínio estoque para clarituz-api.
// Chamadas passam pelo interceptor de auth (Bearer + rotação de refresh em 401).

import { Service } from '@angular/core';
import * as M from '@core/models';
import { ApiHttp } from './api-http';

@Service()
export class EstoqueApi extends ApiHttp {
  listarCategorias(apenasAtivas = false) {
    return this.get<M.CategoriaEstoque[]>('/estoque/categorias', {
      apenas_ativos: apenasAtivas,
    });
  }

  criarCategoria(nome: string) {
    return this.post<M.CategoriaEstoque>('/estoque/categorias', { nome });
  }

  statusCategoria(id: number, ativo: boolean) {
    return this.patch<M.CategoriaEstoque>(`/estoque/categorias/${id}/status`, { ativo });
  }
  /** Roteamento KOT — impressora do setor para a categoria (null = sem ticket). */

  rotaCategoria(id: number, impressora_id: number | null) {
    return this.patch<M.CategoriaEstoque>(`/estoque/categorias/${id}/impressora`, {
      impressora_id,
    });
  }

  excluirCategoria(id: number) {
    return this.del<{ mensagem: string }>(`/estoque/categorias/${id}`);
  }

  listarItens(page = 1, porPagina = 50, apenasAtivos = false) {
    return this.get<M.Page<M.ItemEstoque>>('/estoque/itens', {
      page, por_pagina: porPagina, apenas_ativos: apenasAtivos,
    });
  }

  criarItem(input: M.ItemEstoqueInput) {
    return this.post<M.ItemEstoque>('/estoque/itens', input);
  }

  atualizarItem(id: number, input: M.ItemEstoqueUpdate) {
    return this.put<M.ItemEstoque>(`/estoque/itens/${id}`, input);
  }

  statusItem(id: number, ativo: boolean) {
    return this.patch<M.ItemEstoque>(`/estoque/itens/${id}/status`, { ativo });
  }

  excluirItem(id: number) {
    return this.del<{ mensagem: string }>(`/estoque/itens/${id}`);
  }

  listarMovimentos(page = 1, porPagina = 50) {
    return this.get<M.Page<M.MovimentoView>>('/estoque/movimentacoes', {
      page, por_pagina: porPagina,
    });
  }

  movimentar(movimentos: M.MovimentacaoInput[]) {
    return this.post<{ mensagem: string }>('/estoque/movimentacoes', { movimentos });
  }

  listarFicha(idproduto: number) {
    return this.get<M.FichaItemView[]>(`/estoque/itens/${idproduto}/ficha`);
  }

  salvarFichaItem(idproduto: number, input: M.FichaItemInput) {
    return this.post<M.FichaItemView>(`/estoque/itens/${idproduto}/ficha`, input);
  }

  removerFichaItem(idficha: number) {
    return this.del<{ mensagem: string }>(`/estoque/ficha/${idficha}`);
  }

  listarConversoes(iditem: number) {
    return this.get<M.ConversaoUnidade[]>(`/estoque/itens/${iditem}/conversoes`);
  }

  salvarConversao(iditem: number, input: M.ConversaoInput) {
    return this.post<M.ConversaoUnidade>(`/estoque/itens/${iditem}/conversoes`, input);
  }

  removerConversao(id: number) {
    return this.del<{ mensagem: string }>(`/estoque/conversoes/${id}`);
  }

  alertasEstoque() {
    return this.get<M.EstoqueBaixoView[]>('/estoque/alertas');
  }
  // Compras

  previewNfe(xml: string) {
    return this.post<M.NfePreview>('/estoque/nfe/preview', { xml });
  }

  importarNfe(req: M.NfeImportRequest) {
    return this.post<M.NfeImport>('/estoque/nfe/importar', req);
  }
}
