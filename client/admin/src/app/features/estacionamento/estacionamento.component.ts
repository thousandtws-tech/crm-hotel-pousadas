// UI de estacionamento — template, estilos e bindings. A lógica vive em estacionamento.store.ts.
import { Component } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { EstacionamentoStore } from './estacionamento.store';

@Component({
  selector: 'app-estacionamento',
  imports: [ReactiveFormsModule, MatIconModule, MatSelectModule],
  templateUrl: './estacionamento.component.html',
  styleUrl: './estacionamento.component.css',
})
export class EstacionamentoComponent extends EstacionamentoStore {}
