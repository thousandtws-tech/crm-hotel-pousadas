// UI de nova-reserva-dialog — template, estilos e bindings. A lógica vive em nova-reserva-dialog.store.ts.
import { Component, output } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { num } from '@core/utils/num';
import { DateInputComponent } from '@shared/components/date-input.component';
import { of } from 'rxjs';
import { NovaReservaDialogStore } from './nova-reserva-dialog.store';

@Component({
  selector: 'app-nova-reserva-dialog',
  imports: [ReactiveFormsModule, DecimalPipe, MatIconModule, DateInputComponent],
  templateUrl: './nova-reserva-dialog.component.html',
  styleUrl: './nova-reserva-dialog.component.css',
})
export class NovaReservaDialogComponent extends NovaReservaDialogStore {
  override readonly fechar = output<void>();
  override readonly criada = output<void>();
}
