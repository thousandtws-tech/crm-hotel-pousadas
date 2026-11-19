// Cliente HTTP tipado do domínio operacao para clarituz-api.
// Chamadas passam pelo interceptor de auth (Bearer + rotação de refresh em 401).

import { Service } from '@angular/core';
import * as M from '@core/models';
import { ApiHttp } from './api-http';

@Service()
export class OperacaoApi extends ApiHttp {
  manutOrdens(status?: string) {
    return this.get<M.ManutOrdem[]>('/manutencao/ordens', { status });
  }

  manutCriar(input: Partial<M.ManutOrdem>) {
    return this.post<M.ManutOrdem>('/manutencao/ordens', input);
  }

  manutStatus(id: number, status: M.StatusManut, custo_centavos?: number) {
    return this.post<void>(`/manutencao/ordens/${id}/status`, { status, custo_centavos });
  }

  pmocListar() {
    return this.get<M.PmocRegistro[]>('/manutencao/pmoc');
  }

  pmocItens() {
    return this.get<string[]>('/manutencao/pmoc/itens');
  }

  painelManutencao(status?: string) {
    return this.get<M.PainelManutencao>('/manutencao/painel', { status });
  }

  pmocRegistrar(input: unknown) {
    return this.post<M.PmocRegistro>('/manutencao/pmoc', input);
  }

  govQuadro(data?: string) {
    return this.get<M.GovTarefa[]>('/governanca/tarefas', { data });
  }

  govCriar(input: unknown) {
    return this.post<M.GovTarefa>('/governanca/tarefas', input);
  }

  govStatus(id: number, status: M.StatusTarefaGov) {
    return this.post<void>(`/governanca/tarefas/${id}/status`, { status });
  }

  govAtribuir(id: number, idfuncionario: number) {
    return this.post<void>(`/governanca/tarefas/${id}/atribuir`, { idfuncionario });
  }

  govPrevisao() {
    return this.get<M.PrevisaoDia[]>('/governanca/previsao');
  }

  govGerarD1() {
    return this.post<{ criadas: number }>('/governanca/gerar-d1', {});
  }

  lavLotes() {
    return this.get<M.LavLote[]>('/governanca/lavanderia');
  }

  lavAbrir(input: unknown) {
    return this.post<M.LavLote>('/governanca/lavanderia', input);
  }

  lavDevolver(id: number, qtd_devolvida: number, custo_centavos?: number) {
    return this.post<void>(`/governanca/lavanderia/${id}/devolver`, { qtd_devolvida, custo_centavos });
  }

  lavFechar(competencia: string) {
    return this.post<{ idlancamento: number }>('/governanca/lavanderia/fechar', { competencia });
  }

  enxovalSaldo() {
    return this.get<[string, number][]>('/governanca/enxoval/saldo');
  }

  enxovalMovs() {
    return this.get<M.EnxovalMov[]>('/governanca/enxoval');
  }

  enxovalRegistrar(input: unknown) {
    return this.post<void>('/governanca/enxoval', input);
  }

  painelGovernanca(data?: string) {
    return this.get<M.PainelGovernanca>('/governanca/painel', { data });
  }

  jornadas() {
    return this.get<M.FuncionarioJornada[]>('/escalas/jornadas');
  }

  gravarJornada(input: unknown, dias = 30) {
    return this.post<void>(`/escalas/jornadas?dias=${dias}`, input);
  }

  turnos(inicio: string, fim: string, idfuncionario?: number) {
    return this.get<M.EscalaTurno[]>('/escalas/turnos', { inicio, fim, idfuncionario });
  }

  removerTurno(id: number) {
    return this.del<void>(`/escalas/turnos/${id}`);
  }

  turnoAtualizar(id: number, input: { inicio: string; fim: string; almoco_min: number }) {
    return this.put<void>(`/escalas/turnos/${id}`, input);
  }

  cltValidar(dias = 14) {
    return this.get<M.CltViolacao[]>('/escalas/clt/validar', { dias });
  }

  painelEscalas(inicio?: string, fim?: string) {
    return this.get<M.PainelEscalas>('/escalas/painel', { inicio, fim });
  }

  cltCorrigir(correcao: unknown) {
    return this.post<void>('/escalas/clt/corrigir', correcao);
  }
}
