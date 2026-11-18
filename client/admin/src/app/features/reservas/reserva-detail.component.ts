// UI de reserva-detail — template, estilos e bindings. A lógica vive em reserva-detail.store.ts.
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe, DecimalPipe } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { num } from '@core/utils/num.utils';
import { DateInputComponent } from '@shared/components/date-input/date-input.component';
import { imprimirFnrh } from '@shared/utils/fnrh-print';
import { ReservaFiscalComponent } from './reserva-fiscal.component';
import { ReservaDetailStore } from './reserva-detail.store';

@Component({
  selector: 'app-reserva-detail',
  imports: [
    RouterLink,
    DatePipe,
    DecimalPipe,
    ReactiveFormsModule,
    MatIconModule,
    MatProgressSpinnerModule,
    DateInputComponent,
    ReservaFiscalComponent,
  ],
  templateUrl: './reserva-detail.component.html',
  styleUrl: './reserva-detail.component.css',
})
export class ReservaDetailComponent extends ReservaDetailStore {}
