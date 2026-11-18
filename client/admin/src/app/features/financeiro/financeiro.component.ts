// UI de financeiro — template, estilos e bindings. A lógica vive em financeiro.store.ts.
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { provideNativeDateAdapter } from '@angular/material/core';
import { MatTabsModule } from '@angular/material/tabs';
import { num } from '@core/utils/num.utils';
import { EChartComponent } from '@shared/components/echart/echart.component';
import { FinNavComponent } from './fin-nav.component';
import { FinanceiroStore } from './financeiro.store';

@Component({
  selector: 'app-financeiro',
  providers: [provideNativeDateAdapter()],
  imports: [
    RouterLink,
    DatePipe,
    ReactiveFormsModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatDatepickerModule,
    MatTabsModule,
    EChartComponent,
    FinNavComponent,
  ],
  templateUrl: './financeiro.component.html',
  styleUrl: './financeiro.component.css',
})
export class FinanceiroComponent extends FinanceiroStore {}
