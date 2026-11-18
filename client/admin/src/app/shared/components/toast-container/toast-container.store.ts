// Lógica e estado de toast-container — separada da camada de UI (toast-container.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { inject } from '@angular/core';
import { NotifyService, ToastTipo } from '@core/services/notify.service';
import { Directive } from '@angular/core';

@Directive()
export abstract class ToastContainerStore {
  protected readonly notify = inject(NotifyService);

  protected rotulo(tipo: ToastTipo): string {
    switch (tipo) {
      case 'sucesso':
        return 'Sucesso';
      case 'erro':
        return 'Erro';
      default:
        return 'Atenção';
    }
  }
}
