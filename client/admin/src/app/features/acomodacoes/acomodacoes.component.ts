// UI de acomodacoes — template, estilos e bindings. A lógica vive em acomodacoes.store.ts.
import { DecimalPipe, DatePipe } from '@angular/common';
import { Component } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { num } from '@core/utils/num.utils';
import { Quarto } from '@core/models/catalogo.models';
import { AcomodacoesStore } from './acomodacoes.store';

@Component({
  selector: 'app-acomodacoes',
  host: { '(document:keydown.escape)': 'onEsc()' },
  imports: [
    DecimalPipe,
    DatePipe,
    MatIconModule,
    MatSelectModule,
    MatFormFieldModule,
    ReactiveFormsModule,
  ],
  templateUrl: './acomodacoes.component.html',
  styleUrl: './acomodacoes.component.css',
})
export class AcomodacoesComponent extends AcomodacoesStore {}
