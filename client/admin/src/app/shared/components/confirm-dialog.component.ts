// UI de confirm-dialog — template, estilos e bindings. A lógica vive em confirm-dialog.store.ts.
import { Component, ElementRef, viewChild } from '@angular/core';
import { ConfirmDialogStore } from './confirm-dialog.store';

@Component({
  selector: 'app-confirm',
  host: { '(document:keydown.escape)': 'fechar()' },
  templateUrl: './confirm-dialog.component.html',
})
export class ConfirmDialogComponent extends ConfirmDialogStore {
  protected override readonly cancelarBtn = viewChild<ElementRef<HTMLButtonElement>>('cancelar');
}
