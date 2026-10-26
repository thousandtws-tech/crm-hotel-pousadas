import { Component, inject } from '@angular/core';
import { Notify, ToastTipo } from '@core/services/notify.service';

@Component({
  selector: 'app-toasts',
  template: `
    <div class="toast-stack" aria-live="polite" aria-atomic="false">
      @for (t of notify.toasts(); track t.id) {
        <div class="toast-inn" role="alert">
          <div class="toast-head">
            <span class="toast-ico" [class]="'toast-ico toast-' + t.tipo" aria-hidden="true"></span>
            <strong class="toast-titulo">{{ rotulo(t.tipo) }}</strong>
            <small class="toast-quando">agora</small>
            <button
              type="button"
              class="toast-close"
              (click)="notify.remover(t.id)"
              aria-label="Fechar notificação"
              title="Fechar"
            >
              &times;
            </button>
          </div>
          <div class="toast-body">{{ t.texto }}</div>
          <div class="toast-bar-wrap" aria-hidden="true">
            <div class="toast-bar" [class]="'toast-bar toast-' + t.tipo" [style.animation-duration]="t.delay + 'ms'"></div>
          </div>
        </div>
      }
    </div>
  `,
})
export class ToastContainerComponent {
  protected readonly notify = inject(Notify);

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
