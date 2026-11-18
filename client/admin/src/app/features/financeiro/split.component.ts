// UI de split — template, estilos e bindings. A lógica vive em split.store.ts.
import { Component } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { DateInputComponent } from '@shared/components/date-input/date-input.component';
import { num } from '@core/utils/num';
import { FinNavComponent } from './fin-nav.component';
import { FinSplitStore } from './split.store';

@Component({
  selector: 'app-fin-split',
  imports: [FinNavComponent, DatePipe, ReactiveFormsModule, MatIconModule, DateInputComponent],
  templateUrl: './split.component.html',
  styleUrl: './split.component.css',
})
export class FinSplitComponent extends FinSplitStore {}
