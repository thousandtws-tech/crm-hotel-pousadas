// UI de toast-container — template, estilos e bindings. A lógica vive em toast-container.store.ts.
import { Component } from '@angular/core';
import { ToastContainerStore } from './toast-container.store';

@Component({
  selector: 'app-toasts',
  templateUrl: './toast-container.component.html',
})
export class ToastContainerComponent extends ToastContainerStore {}
