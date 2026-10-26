import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog.component';
import { ToastContainerComponent } from '@shared/components/toast-container.component';

@Component({
  imports: [RouterOutlet, ToastContainerComponent, ConfirmDialogComponent],
  selector: 'app-root',
  template: '<router-outlet /><app-toasts /><app-confirm />',
})
export class App {}
