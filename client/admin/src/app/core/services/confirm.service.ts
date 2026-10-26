import { Service, signal } from '@angular/core';

export interface ConfirmOpts {
  readonly titulo?: string;
  readonly confirmar?: string;
  readonly cancelar?: string;
  readonly detalhe?: string;
}

interface ConfirmReq {
  readonly titulo: string;
  readonly mensagem: string;
  readonly confirmar: string;
  readonly cancelar: string;
  readonly detalhe: string | null;
  readonly resolver: (ok: boolean) => void;
}

@Service()
export class Confirm {
  private readonly estado = signal<ConfirmReq | null>(null);
  readonly atual = this.estado.asReadonly();

  perguntar(mensagem: string, opts: ConfirmOpts = {}): Promise<boolean> {
    return new Promise((resolve) => {
      this.estado.set({
        titulo: opts.titulo ?? 'Confirmar ação',
        mensagem,
        confirmar: opts.confirmar ?? 'Confirmar',
        cancelar: opts.cancelar ?? 'Cancelar',
        detalhe: opts.detalhe ?? null,
        resolver: resolve,
      });
    });
  }

  responder(ok: boolean): void {
    const req = this.estado();
    if (!req) return;
    this.estado.set(null);
    req.resolver(ok);
  }
}
