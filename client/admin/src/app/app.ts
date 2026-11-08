import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog.component';
import { ToastContainerComponent } from '@shared/components/toast-container.component';

@Component({
  imports: [RouterOutlet, ToastContainerComponent, ConfirmDialogComponent],
  selector: 'app-root',
  template: '<router-outlet /><app-toasts /><app-confirm />',
})
export class App {
  constructor() {
    const sw = inject(SwUpdate);
    if (!sw.isEnabled) return;
    sw.versionUpdates.subscribe((ev) => {
      if (ev.type === 'VERSION_READY') {
        void sw.activateUpdate().then(() => document.location.reload());
      }
    });
  }
}
