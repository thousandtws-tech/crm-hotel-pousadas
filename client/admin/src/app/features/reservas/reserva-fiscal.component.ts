// UI de reserva-fiscal — template, estilos e bindings. A lógica vive em reserva-fiscal.store.ts.
import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { ReservaFiscalStore } from './reserva-fiscal.store';

@Component({
  selector: 'app-reserva-fiscal',
  imports: [DatePipe, DecimalPipe, MatIconModule],
  templateUrl: './reserva-fiscal.component.html',
  styleUrl: './reserva-fiscal.component.css',
})
export class ReservaFiscalComponent extends ReservaFiscalStore {
  override readonly idreserva = input.required<number>();
}
