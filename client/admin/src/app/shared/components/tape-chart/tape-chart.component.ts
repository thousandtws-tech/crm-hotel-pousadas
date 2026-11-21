// UI do tape chart reutilizável — apenas decorador e bindings. Lógica em tape-chart.store.ts.
import { Component, output } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { TapeChartStore } from './tape-chart.store';

@Component({
  selector: 'app-tape-chart',
  imports: [DatePipe, MatIconModule],
  templateUrl: './tape-chart.component.html',
  styleUrl: './tape-chart.component.css',
})
export class TapeChartComponent extends TapeChartStore {
  override readonly novaReserva = output<{
    idacomodacao: number;
    entrada: string;
    saida: string;
  }>();
}
