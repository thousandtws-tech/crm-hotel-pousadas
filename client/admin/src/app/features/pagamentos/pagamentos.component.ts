// UI de pagamentos — template, estilos e bindings. A lógica vive em pagamentos.store.ts.
import { Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { PagamentosStore } from './pagamentos.store';

@Component({
  selector: 'app-pagamentos',
  host: { '(document:keydown.escape)': 'onEsc()' },
  imports: [MatIconModule],
  templateUrl: './pagamentos.component.html',
  styleUrl: './pagamentos.component.css',
})
export class PagamentosComponent extends PagamentosStore {}
