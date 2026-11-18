// UI de reservas — template, estilos e bindings. A lógica vive em reservas.store.ts.
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ReactiveFormsModule } from '@angular/forms';
import { DatePipe, DecimalPipe } from '@angular/common';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatIconModule } from '@angular/material/icon';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { provideNativeDateAdapter } from '@angular/material/core';
import { num } from '@core/utils/num';
import { NovaReservaDialogComponent } from './nova-reserva-dialog.component';
import { ReservasStore } from './reservas.store';

@Component({
  selector: 'app-reservas',
  providers: [provideNativeDateAdapter()],
  imports: [
    RouterLink,
    DatePipe,
    DecimalPipe,
    ReactiveFormsModule,
    MatPaginatorModule,
    MatIconModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatInputModule,
    NovaReservaDialogComponent,
  ],
  templateUrl: './reservas.component.html',
  styleUrls: ['./reservas.component.css', './reservas.extra.css'],
})
export class ReservasComponent extends ReservasStore {}
