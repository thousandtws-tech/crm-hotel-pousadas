// UI de date-input — template, estilos e bindings. A lógica vive em date-input.store.ts.
import { Component, forwardRef, input, output } from '@angular/core';
import { NG_VALUE_ACCESSOR, ReactiveFormsModule } from '@angular/forms';
import { DateAdapter, MAT_DATE_FORMATS, MAT_DATE_LOCALE } from '@angular/material/core';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatIconModule } from '@angular/material/icon';
import { BrDateAdapter, BR_FORMATS, DateInputStore } from './date-input.store';

@Component({
  selector: 'app-date',
  imports: [ReactiveFormsModule, MatDatepickerModule, MatIconModule],
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => DateInputComponent), multi: true },
    { provide: MAT_DATE_LOCALE, useValue: 'pt-BR' },
    { provide: DateAdapter, useClass: BrDateAdapter },
    { provide: MAT_DATE_FORMATS, useValue: BR_FORMATS },
  ],
  templateUrl: './date-input.component.html',
  styleUrl: './date-input.component.css',
})
export class DateInputComponent extends DateInputStore {
  override readonly value = input<string | null>(null);
  override readonly min = input<string | null>(null);
  override readonly max = input<string | null>(null);
  override readonly rotulo = input<string | null>(null);
  override readonly alterar = output<string>();
}
