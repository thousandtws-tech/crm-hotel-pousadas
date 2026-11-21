// UI de recepcao — template, estilos e bindings. A lógica vive em recepcao.store.ts.
import { Component } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule } from '@angular/material/paginator';
import { TapeChartComponent } from '../../shared/components/tape-chart/tape-chart.component';
import { NovaReservaDialogComponent } from '@shared/components/nova-reserva-dialog/nova-reserva-dialog.component';
import { RecepcaoStore } from './recepcao.store';

@Component({
  selector: 'app-recepcao',
  imports: [
    DatePipe,
    DecimalPipe,
    RouterLink,
    ReactiveFormsModule,
    MatIconModule,
    MatPaginatorModule,
    TapeChartComponent,
    NovaReservaDialogComponent,
  ],
  templateUrl: './recepcao.component.html',
  styleUrls: ['./recepcao.component.css', './recepcao.extra.css'],
})
export class RecepcaoComponent extends RecepcaoStore {}
