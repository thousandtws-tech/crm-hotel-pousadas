// UI de estabelecimento — template, estilos e bindings. A lógica vive em estabelecimento.store.ts.
import { Component } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { EstabelecimentoStore } from './estabelecimento.store';

@Component({
  selector: 'app-estabelecimento',
  host: { '(document:keydown.escape)': 'onEsc()' },
  imports: [ReactiveFormsModule, MatIconModule, MatFormFieldModule, MatSelectModule],
  templateUrl: './estabelecimento.component.html',
  styleUrl: './estabelecimento.component.css',
})
export class EstabelecimentoComponent extends EstabelecimentoStore {}
