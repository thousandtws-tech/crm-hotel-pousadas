// UI de fluxo-caixa — template, estilos e bindings. A lógica vive em fluxo-caixa.store.ts.
import { Component } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { provideNativeDateAdapter } from '@angular/material/core';
import { num } from '@core/utils/num';
import { EChartComponent } from '@shared/components/echart.component';
import { FinNavComponent } from './fin-nav.component';
import { FinFluxoCaixaStore } from './fluxo-caixa.store';

@Component({
  selector: 'app-fin-fluxo-caixa',
  providers: [provideNativeDateAdapter()],
  imports: [
    FinNavComponent,
    DatePipe,
    ReactiveFormsModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatDatepickerModule,
    EChartComponent,
  ],
  templateUrl: './fluxo-caixa.component.html',
  styleUrl: './fluxo-caixa.component.css',
})
export class FinFluxoCaixaComponent extends FinFluxoCaixaStore {}
