// UI de fin-nav — template, estilos e bindings. A lógica vive em fin-nav.store.ts.
import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { FinNavStore } from './fin-nav.store';

@Component({
  selector: 'app-fin-nav',
  imports: [RouterLink, RouterLinkActive, MatIconModule],
  templateUrl: './fin-nav.component.html',
  styleUrl: './fin-nav.component.css',
})
export class FinNavComponent extends FinNavStore {}
