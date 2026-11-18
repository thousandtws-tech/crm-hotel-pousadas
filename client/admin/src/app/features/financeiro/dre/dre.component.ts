// UI de dre — template, estilos e bindings. A lógica vive em dre.store.ts.
import { Component } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { provideNativeDateAdapter } from '@angular/material/core';
import { num } from '@core/utils/num';
import { FinNavComponent } from '../fin-nav/fin-nav.component';
import { FinDreStore } from './dre.store';

@Component({
  selector: 'app-fin-dre',
  providers: [provideNativeDateAdapter()],
  imports: [
    FinNavComponent,
    DatePipe,
    ReactiveFormsModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatDatepickerModule,
  ],
  templateUrl: './dre.component.html',
  styleUrl: './dre.component.css',
})
export class FinDreComponent extends FinDreStore {}
