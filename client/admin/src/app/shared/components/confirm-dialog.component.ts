import { Component, ElementRef, effect, inject, viewChild } from '@angular/core';
import { Confirm } from '@core/services/confirm.service';

@Component({
  selector: 'app-confirm',
  host: { '(document:keydown.escape)': 'fechar()' },
  template: `
    @if (confirm.atual(); as r) {
      <div class="overlay overlay-confirm" (click.self)="fechar()">
        <div
          class="modal-inn modal-confirm"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="confirm-titulo"
          aria-describedby="confirm-msg"
        >
          <div class="modal-head">
            <h5 id="confirm-titulo">{{ r.titulo }}</h5>
            <button type="button" class="close" (click)="fechar()" aria-label="Fechar">&times;</button>
          </div>
          <div class="modal-body">
            <p id="confirm-msg" class="confirm-msg">{{ r.mensagem }}</p>
            <p class="confirm-dica">{{ r.detalhe ?? 'Essa ação não poderá ser desfeita.' }}</p>
          </div>
          <div class="confirm-foot">
            <button type="button" class="btn-gray" #cancelar (click)="confirm.responder(false)">
              {{ r.cancelar }}
            </button>
            <button type="button" class="btn-danger" (click)="confirm.responder(true)">
              {{ r.confirmar }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class ConfirmDialogComponent {
  protected readonly confirm = inject(Confirm);
  private readonly cancelarBtn = viewChild<ElementRef<HTMLButtonElement>>('cancelar');

  constructor() {
    effect(() => {
      if (this.confirm.atual()) this.cancelarBtn()?.nativeElement.focus();
    });
  }

  protected fechar(): void {
    this.confirm.responder(false);
  }
}
