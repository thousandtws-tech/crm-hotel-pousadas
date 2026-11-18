// UI de pagamentos-online — template, estilos e bindings. A lógica vive em pagamentos-online.store.ts.
import { Component } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FinPagamentosOnlineStore } from './pagamentos-online.store';

@Component({
  selector: 'app-fin-pagamentos-online',
  imports: [FormsModule, DatePipe],
  templateUrl: './pagamentos-online.component.html',
  styleUrls: ['./pagamentos-online.component.css'],
})
export class FinPagamentosOnlineComponent extends FinPagamentosOnlineStore {}
