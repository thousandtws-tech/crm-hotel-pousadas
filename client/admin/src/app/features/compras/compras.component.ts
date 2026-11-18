// UI de compras — template, estilos e bindings. A lógica vive em compras.store.ts.
import { DatePipe } from '@angular/common';
import { Component } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { DateInputComponent } from '@shared/components/date-input.component';
import { Fornecedor } from '@core/models/compras.models';
import { ComprasStore } from './compras.store';

@Component({
  selector: 'app-compras',
  imports: [ReactiveFormsModule, MatIconModule, DatePipe, DateInputComponent],
  host: { '(document:keydown.escape)': 'fecharModais()' },
  templateUrl: './compras.component.html',
  styleUrl: './compras.component.css',
})
export class ComprasComponent extends ComprasStore {}
