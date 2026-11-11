// Cliente HTTP tipado do domínio clientes para clarituz-api.
// Chamadas passam pelo interceptor de auth (Bearer + rotação de refresh em 401).

import { Service } from '@angular/core';
import * as M from '@core/models';
import { ApiHttp } from './api-http';

@Service()
export class ClientesApi extends ApiHttp {
  listarClientes(busca: string | null, page = 1, porPagina = 20, apenasAtivos = false) {
    return this.get<M.Page<M.Cliente>>('/clientes', {
      busca, page, por_pagina: porPagina, apenas_ativos: apenasAtivos,
    });
  }

  buscarCliente(id: number) {
    return this.get<M.Cliente>(`/clientes/${id}`);
  }

  criarCliente(input: M.ClienteInput) {
    return this.post<M.Cliente>('/clientes', input);
  }

  atualizarCliente(id: number, input: M.ClienteInput) {
    return this.put<M.Cliente>(`/clientes/${id}`, input);
  }

  statusCliente(id: number, ativo: boolean) {
    return this.patch<M.Cliente>(`/clientes/${id}/status`, { ativo });
  }

  excluirCliente(id: number) {
    return this.del<void>(`/clientes/${id}`);
  }
  /** Foto cadastrada do cliente (blob autenticado — use URL.createObjectURL). */

  fotoCliente(id: number) {
    return this.http.get(`${this.base}/clientes/${id}/foto`, {
      responseType: 'blob',
    });
  }

  uploadFotoCliente(id: number, f: Blob) {
    return this.http.put(`${this.base}/clientes/${id}/foto`, f, {
      headers: { 'Content-Type': f.type || 'image/jpeg' },
    });
  }

  removerFotoCliente(id: number) {
    return this.del<void>(`/clientes/${id}/foto`);
  }

  listarDocumentos(idcliente: number) {
    return this.get<M.ClienteDocumento[]>(`/clientes/${idcliente}/documentos`);
  }

  criarDocumento(idcliente: number, input: M.DocumentoInput) {
    return this.post<M.ClienteDocumento>(`/clientes/${idcliente}/documentos`, input);
  }

  atualizarDocumento(id: number, input: M.DocumentoInput) {
    return this.put<M.ClienteDocumento>(`/documentos/${id}`, input);
  }

  removerDocumento(id: number) {
    return this.del<void>(`/documentos/${id}`);
  }
  /** Scan digitalizado (blob autenticado — use URL.createObjectURL). */

  scanDocumento(id: number) {
    return this.http.get(`${this.base}/documentos/${id}/scan`, {
      responseType: 'blob',
    });
  }

  uploadScanDocumento(id: number, f: Blob) {
    return this.http.put(`${this.base}/documentos/${id}/scan`, f, {
      headers: { 'Content-Type': f.type || 'image/jpeg' },
    });
  }

  removerScanDocumento(id: number) {
    return this.del<void>(`/documentos/${id}/scan`);
  }
  /** Arquivo digital do hóspede — todas as FNRHs já emitidas. */

  fnrhCliente(id: number) {
    return this.get<M.Fnrh[]>(`/clientes/${id}/fnrh`);
  }

  lgpdExportarCliente(idcliente: number) {
    return this.get<unknown>(`/clientes/${idcliente}/lgpd-export`);
  }

  anonimizarCliente(idcliente: number) {
    return this.post<void>(`/clientes/${idcliente}/anonimizar`, {});
  }
}
