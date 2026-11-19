// Cliente HTTP tipado do domínio pdv para clarituz-api.
// Chamadas passam pelo interceptor de auth (Bearer + rotação de refresh em 401).

import { Service } from '@angular/core';
import * as M from '@core/models';
import { ApiHttp } from './api-http';

@Service()
export class PdvApi extends ApiHttp {
  /** PDV — as 9 leituras do boot (mesas, comandas, abertas, garçons e auxiliares) em 1 chamada. */
  painelPdv(f: {
    tipo?: string | null; status?: string | null; idgarcom?: number | null;
    inicio?: string | null; fim?: string | null; page?: number; porPagina?: number;
  } = {}) {
    return this.get<M.PainelPdv>('/pdv/painel', {
      tipo: f.tipo, status: f.status, idgarcom: f.idgarcom,
      inicio: f.inicio, fim: f.fim,
      page: f.page ?? 1, por_pagina: f.porPagina ?? 20,
    });
  }

  listarMesas() {
    return this.get<M.MesaView[]>('/pdv/mesas');
  }

  criarMesa(numero: string, lugares: number) {
    return this.post<M.PdvMesa>('/pdv/mesas', { numero, lugares });
  }

  statusMesa(id: number, ativo: boolean) {
    return this.put<M.PdvMesa>(`/pdv/mesas/${id}/status`, { ativo });
  }

  listarGarcons() {
    return this.get<M.GarcomView[]>('/pdv/garcons');
  }

  salvarGarcom(idfuncionario: number, percentual: number, ativo = true) {
    return this.post<M.PdvGarcom>('/pdv/garcons', { idfuncionario, percentual, ativo });
  }

  listarComandas(f: {
    tipo?: string | null; status?: string | null; idgarcom?: number | null;
    inicio?: string | null; fim?: string | null; page?: number; porPagina?: number;
  }) {
    return this.get<M.Page<M.ComandaView>>('/pdv/comandas', {
      tipo: f.tipo, status: f.status, idgarcom: f.idgarcom,
      inicio: f.inicio, fim: f.fim,
      page: f.page ?? 1, por_pagina: f.porPagina ?? 50,
    });
  }

  abrirComanda(input: M.AbrirComandaInput) {
    return this.post<M.PdvComanda>('/pdv/comandas', input);
  }

  buscarComanda(id: number) {
    return this.get<M.ComandaView>(`/pdv/comandas/${id}`);
  }

  itensComanda(id: number) {
    return this.get<M.ComandaItemView[]>(`/pdv/comandas/${id}/itens`);
  }

  adicionarItem(id: number, iditem: number, quantidade: number) {
    return this.post<M.PdvComandaItem>(`/pdv/comandas/${id}/itens`, { iditem, quantidade });
  }

  entregarItem(id: number, iditemComanda: number) {
    return this.post<M.PdvComandaItem>(`/pdv/comandas/${id}/itens/${iditemComanda}/entregar`, {});
  }

  cancelarItem(id: number, iditemComanda: number, motivo?: string) {
    return this.post<M.PdvComandaItem>(`/pdv/comandas/${id}/itens/${iditemComanda}/cancelar`, { motivo });
  }

  cancelarComanda(id: number, motivo?: string) {
    return this.post<M.PdvComanda>(`/pdv/comandas/${id}/cancelar`, { motivo });
  }

  fecharComanda(id: number, input: M.FecharComandaInput) {
    return this.post<M.PdvComanda>(`/pdv/comandas/${id}/fechar`, input);
  }

  itensVenda(busca?: string) {
    return this.get<M.ItemVendaView[]>('/pdv/itens-venda', { busca });
  }
  // ------------------------------------------------------------------ KDS

  filaCozinha() {
    return this.get<M.FilaItemView[]>('/pdv/cozinha/fila');
  }

  prepararItem(id: number, iditemComanda: number) {
    return this.post<M.PdvComandaItem>(`/pdv/comandas/${id}/itens/${iditemComanda}/preparar`, {});
  }

  prontoItem(id: number, iditemComanda: number) {
    return this.post<M.PdvComandaItem>(`/pdv/comandas/${id}/itens/${iditemComanda}/pronto`, {});
  }

  retornarItem(id: number, iditemComanda: number) {
    return this.post<M.PdvComandaItem>(`/pdv/comandas/${id}/itens/${iditemComanda}/retornar`, {});
  }
  // ------------------------------------------------------------------ Café

  resumoComissoes(inicio?: string | null, fim?: string | null) {
    return this.get<M.ComissaoResumo[]>('/pdv/comissoes/resumo', { inicio, fim });
  }

  pagarComissao(id: number, idcontaFinanceira: number, idformaPagamento?: number | null) {
    return this.post<M.PdvComissao>(`/pdv/comissoes/${id}/pagar`, {
      idconta_financeira: idcontaFinanceira,
      idforma_pagamento: idformaPagamento,
    });
  }
}
