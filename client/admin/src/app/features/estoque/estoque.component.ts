// UI de estoque — template, estilos e bindings. A lógica vive em estoque.store.ts.
import { Component } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { DatePipe, DecimalPipe } from '@angular/common';
import { MatTabsModule } from '@angular/material/tabs';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { num } from '@core/utils/num.utils';
import { Impressora } from '@core/models/estabelecimento.models';
import { EstoqueStore } from './estoque.store';

@Component({
  selector: 'app-estoque',
  host: { '(document:keydown.escape)': 'onEsc()' },
  imports: [
    DatePipe,
    DecimalPipe,
    MatTabsModule,
    MatIconModule,
    MatSelectModule,
    MatFormFieldModule,
    ReactiveFormsModule,
    RouterLink,
  ],
  templateUrl: './estoque.component.html',
  styleUrl: './estoque.component.css',
})
export class EstoqueComponent extends EstoqueStore {}
