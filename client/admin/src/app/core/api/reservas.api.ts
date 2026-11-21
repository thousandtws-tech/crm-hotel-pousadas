// Cliente HTTP tipado do domínio reservas para clarituz-api.
// Chamadas passam pelo interceptor de auth (Bearer + rotação de refresh em 401).

import { Service } from '@angular/core';
import * as M from '@core/models';
import { ApiHttp, params } from './api-http';

@Service()
export class ReservasApi extends ApiHttp {
  listarAcompanhantes(idreserva: number) {
    return this.get<M.Acompanhante[]>(`/reservas/${idreserva}/acompanhantes`);
  }

  adicionarAcompanhante(idreserva: number, input: M.AcompanhanteInput) {
    return this.post<M.Acompanhante>(`/reservas/${idreserva}/acompanhantes`, input);
  }

  removerAcompanhante(id: number) {
    return this.del<void>(`/acompanhantes/${id}`);
  }

  /** Dispara o link da pré-ficha (pré-check-in) para o hóspede. */
  enviarPreCheckin(idreserva: number) {
    return this.post<void>(`/reservas/${idreserva}/fnrh-link`, {});
  }

  /** Foto do documento da pré-ficha (blob autenticado — createObjectURL). */
  fnrhDocumento(idreserva: number) {
    return this.http.get(`${this.base}/reservas/${idreserva}/fnrh-documento`, {
      responseType: 'blob',
    });
  }

  fnrhReserva(idreserva: number) {
    return this.get<M.Fnrh[]>(`/reservas/${idreserva}/fnrh`);
  }

  emitirFnrh(idreserva: number, req: { motivo_viagem?: string | null; placa_veiculo?: string | null }) {
    return this.post<M.Fnrh>(`/reservas/${idreserva}/fnrh`, req);
  }
  /** Fechamento do dia — pendências + no-show por PIN + relatório e-mail. */

  pendenciasFechamento() {
    return this.get<M.PendenciasFechamento>('/fechamento/pendencias');
  }

  marcarNoShow(idreserva: number, pin: string) {
    return this.post<void>(`/reservas/${idreserva}/no-show`, { pin });
  }

  enviarRelatorioFechamento() {
    return this.post<void>('/fechamento/relatorio', {});
  }

  /** Exportação SNE/CSV das fichas do período — envio manual ao MTur. */

  exportarFnrh(inicio: string, fim: string) {
    return this.http.get(`${this.base}/fnrh/exportar`, {
      params: params({ inicio, fim }),
      responseType: 'text',
    });
  }

  listarReservas(f: {
    inicio?: string | null; fim?: string | null; status?: string | null;
    idacomodacao?: number | null; idcliente?: number | null;
    busca?: string | null;
    page?: number; porPagina?: number;
  }) {
    return this.get<M.Page<M.ReservaResumo>>('/reservas', {
      inicio: f.inicio, fim: f.fim, status: f.status,
      idacomodacao: f.idacomodacao, idcliente: f.idcliente, busca: f.busca,
      page: f.page ?? 1, por_pagina: f.porPagina ?? 20,
    });
  }

  eventosReserva(inicio?: string | null, fim?: string | null) {
    return this.get<M.ReservaResumo[]>('/reservas/eventos', { inicio, fim });
  }

  /** Grade de tarifas por dia — alimenta as células do tape chart. */
  precosGrade(inicio: string, fim: string) {
    return this.get<M.PrecoDia[]>('/reservas/precos-grade', { inicio, fim });
  }

  disponibilidade(inicio: string, fim: string, idacomodacao?: number | null) {
    return this.get<M.DisponibilidadeResponse>('/reservas/disponibilidade', {
      inicio, fim, idacomodacao,
    });
  }

  buscarReserva(id: number) {
    return this.get<M.ReservaDetalhe>(`/reservas/${id}`);
  }

  criarReserva(input: M.ReservaInput) {
    return this.post<M.Reserva>('/reservas', input);
  }

  remanejar(id: number, input: M.RemanejarInput) {
    return this.post<M.Reserva>(`/reservas/${id}/remanejar`, input);
  }

  checkin(id: number, data?: string | null, hora?: string | null) {
    return this.post<M.Reserva>(`/reservas/${id}/check-in`, { data, hora });
  }

  checkout(id: number, req: M.CheckoutRequest) {
    return this.post<M.CheckoutResponse>(`/reservas/${id}/check-out`, req);
  }

  cancelarReserva(id: number, req: M.CancelarReservaRequest) {
    return this.post<{ reserva: M.Reserva; reembolso: unknown }>(
      `/reservas/${id}/cancelar`, req,
    );
  }
  /** Exclui reserva pendente/cancelada junto com a conta de consumo (admin). */

  excluirReserva(id: number) {
    return this.del<void>(`/reservas/${id}`);
  }

  itensConsumidos(id: number) {
    return this.get<M.ItemConsumido[]>(`/reservas/${id}/itens-consumidos`);
  }

  registrarItemConsumido(id: number, iditem_frigobar: number, quantidade: number) {
    return this.post<M.ItemConsumido>(`/reservas/${id}/itens-consumidos`, {
      iditem_frigobar, quantidade,
    });
  }

  adicionais(id: number) {
    return this.get<M.AdicionalConsumo[]>(`/reservas/${id}/adicionais`);
  }
  /** Lançamento avulso na conta durante a estadia. */

  lancarAdicional(idreserva: number, motivo: string, valor: number) {
    return this.post<M.AdicionalConsumo>(`/reservas/${idreserva}/adicionais`, {
      motivo,
      valor,
    });
  }

  autorizacaoMenor(idreserva: number, documento: string) {
    return this.post<void>(`/reservas/${idreserva}/autorizacao-menor`, { documento });
  }
  // -- Mapa por andar + bloqueio ----------------------------------------------

  mapaQuartos() {
    return this.get<M.MapaQuarto[]>('/reservas/mapa');
  }

  /** Recepção — chegadas + na casa + mapa do dia em uma chamada. */
  painelRecepcao(data: string) {
    return this.get<M.PainelRecepcao>('/reservas/painel-recepcao', { data });
  }

  widgetMotor() {
    return this.get<{ url: string; qr_svg: string; snippet: string }>('/reservas/widget');
  }

  bloqueios() {
    return this.get<M.Bloqueio[]>('/bloqueios');
  }
  // -- Grupos / eventos --------------------------------------------------------

  grupos() {
    return this.get<M.Grupo[]>('/grupos');
  }

  criarGrupo(input: M.GrupoInput) {
    return this.post<M.Grupo>('/grupos', input);
  }

  grupoUnidades(id: number) {
    return this.get<M.GrupoUnidadeView[]>(`/grupos/${id}/unidades`);
  }

  removerGrupo(id: number) {
    return this.del<void>(`/grupos/${id}`);
  }

  bloquear(idacomodacao: number, inicio: string, fim: string, motivo: string) {
    return this.post<M.Bloqueio>(`/acomodacoes/${idacomodacao}/bloqueio`, { inicio, fim, motivo });
  }

  desbloquear(id: number) {
    return this.del<void>(`/bloqueios/${id}`);
  }
  // -- Atendimento (roteamento) ------------------------------------------------
}
