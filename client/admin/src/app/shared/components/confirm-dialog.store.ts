// Lógica e estado de confirm-dialog — separada da camada de UI (confirm-dialog.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { ElementRef, effect, inject } from '@angular/core';
import { Confirm } from '@core/services/confirm.service';
import type { Signal } from '@angular/core';
import { Directive } from '@angular/core';

@Directive()
export abstract class ConfirmDialogStore {
  declare protected readonly cancelarBtn: Signal<ElementRef<HTMLButtonElement> | undefined>;
  protected readonly confirm = inject(Confirm);

  constructor() {
    effect(() => {
      if (this.confirm.atual()) this.cancelarBtn()?.nativeElement.focus();
    });
  }

  protected fechar(): void {
    this.confirm.responder(false);
  }
}
