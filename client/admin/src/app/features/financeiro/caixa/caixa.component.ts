// UI de caixa — template, estilos e bindings. A lógica vive em caixa.store.ts.
import { Component } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { num } from '@core/utils/num';
import { FinNavComponent } from '../fin-nav/fin-nav.component';
import { RouterLink } from '@angular/router';
import { DecimalPipe } from '@angular/common';
import { FinCaixaStore } from './caixa.store';

@Component({
  selector: 'app-fin-caixa',
  imports: [FinNavComponent, DatePipe, DecimalPipe, ReactiveFormsModule, MatIconModule, RouterLink],
  templateUrl: './caixa.component.html',
  styleUrl: './caixa.component.css',
})
export class FinCaixaComponent extends FinCaixaStore {}
