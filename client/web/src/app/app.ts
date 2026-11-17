import { Component, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import { filter } from 'rxjs';

@Component({
  imports: [RouterOutlet],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  protected readonly title = signal('web');

  constructor() {
    const swUpdate = inject(SwUpdate);

    // Deploy novo publicado → ativa e recarrega: o usuário nunca fica
    // preso numa versão antiga do app shell.
    swUpdate.versionUpdates
      .pipe(filter((e) => e.type === 'VERSION_READY'))
      .subscribe(() => {
        void swUpdate.activateUpdate().then(() => document.location.reload());
      });

    // Cache do SW corrompido/obsoleto demais → recarrega limpo.
    swUpdate.unrecoverable.subscribe(() => document.location.reload());
  }
}
