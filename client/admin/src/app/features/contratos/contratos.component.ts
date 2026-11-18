// UI de contratos — template, estilos e bindings. A lógica vive em contratos.store.ts.
import { Component } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { ContratosStore } from './contratos.store';

@Component({
  selector: 'app-contratos',
  imports: [ReactiveFormsModule, MatIconModule],
  templateUrl: './contratos.component.html',
  styleUrl: './contratos.component.css',
})
export class ContratosComponent extends ContratosStore {}
