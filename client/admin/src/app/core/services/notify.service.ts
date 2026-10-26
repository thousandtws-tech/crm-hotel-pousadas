import { HttpErrorResponse } from '@angular/common/http';
import { Service, signal } from '@angular/core';
import { ApiErro } from '@core/models/api.models';

export type ToastTipo = 'sucesso' | 'erro' | 'aviso';

export interface ToastMsg {
  readonly id: number;
  readonly texto: string;
  readonly tipo: ToastTipo;
  readonly delay: number;
}

@Service()
export class Notify {
  readonly toasts = signal<readonly ToastMsg[]>([]);
  private seq = 0;

  ok(msg: string): void {
    this.push(msg, 'sucesso', 2200);
  }

  aviso(msg: string): void {
    this.push(msg, 'aviso', 3500);
  }

  erroMsg(msg: string): void {
    this.push(msg, 'erro', 4500);
  }

  erro(err: unknown): void {
    let msg = 'Erro inesperado. Tente novamente.';
    if (err instanceof HttpErrorResponse) {
      const body = err.error as ApiErro | undefined;
      msg = body?.erro?.mensagem ?? `Falha na requisição (HTTP ${err.status}).`;
      if (err.status === 0) msg = 'API indisponível — verifique se o servidor está no ar.';
    }
    this.push(msg, 'erro', 4500);
  }

  remover(id: number): void {
    this.toasts.update((lista) => lista.filter((t) => t.id !== id));
  }

  private push(texto: string, tipo: ToastTipo, delay: number): void {
    const id = ++this.seq;
    this.toasts.update((lista) => [...lista, { id, texto, tipo, delay }]);
    setTimeout(() => this.remover(id), delay);
  }
}
