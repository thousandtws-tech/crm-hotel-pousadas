// UI de operadoras — template, estilos e bindings. A lógica vive em operadoras.store.ts.
import { Component } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { OperadorasStore } from './operadoras.store';

@Component({
  selector: 'app-operadoras',
  imports: [ReactiveFormsModule, MatIconModule],
  templateUrl: './operadoras.component.html',
  styleUrl: './operadoras.component.css',
})
export class OperadorasComponent extends OperadorasStore {}
