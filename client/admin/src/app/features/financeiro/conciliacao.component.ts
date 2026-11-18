// UI de conciliacao — template, estilos e bindings. A lógica vive em conciliacao.store.ts.
import { Component } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { num } from '@core/utils/num';
import { FinNavComponent } from './fin-nav.component';
import { FinConciliacaoStore } from './conciliacao.store';

@Component({
  selector: 'app-fin-conciliacao',
  imports: [FinNavComponent, DatePipe, ReactiveFormsModule, MatIconModule],
  templateUrl: './conciliacao.component.html',
  styleUrl: './conciliacao.component.css',
})
export class FinConciliacaoComponent extends FinConciliacaoStore {}
