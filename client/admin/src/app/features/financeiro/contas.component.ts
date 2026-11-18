// UI de contas — template, estilos e bindings. A lógica vive em contas.store.ts.
import { Component } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { DateInputComponent } from '@shared/components/date-input/date-input.component';
import { num } from '@core/utils/num';
import { FinNavComponent } from './fin-nav.component';
import { FinContasStore } from './contas.store';

@Component({
  selector: 'app-fin-contas',
  imports: [FinNavComponent, DatePipe, ReactiveFormsModule, MatIconModule, DateInputComponent],
  templateUrl: './contas.component.html',
  styleUrl: './contas.component.css',
})
export class FinContasComponent extends FinContasStore {}
