// UI de insumos — template, estilos e bindings. A lógica vive em insumos.store.ts.
import { Component } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { DateInputComponent } from '@shared/components/date-input.component';
import { RouterLink } from '@angular/router';
import { InsumosStore } from './insumos.store';

@Component({
  selector: 'app-insumos',
  imports: [ReactiveFormsModule, MatIconModule, RouterLink, DateInputComponent],
  templateUrl: './insumos.component.html',
  styleUrl: './insumos.component.css',
})
export class InsumosComponent extends InsumosStore {}
