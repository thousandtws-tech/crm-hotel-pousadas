// UI de auditoria — template, estilos e bindings. A lógica vive em auditoria.store.ts.
import { Component } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { DatePipe, JsonPipe } from '@angular/common';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatIconModule } from '@angular/material/icon';
import { DateInputComponent } from '@shared/components/date-input.component';
import { AuditoriaStore } from './auditoria.store';

@Component({
  selector: 'app-auditoria',
  imports: [
    DatePipe,
    JsonPipe,
    ReactiveFormsModule,
    MatPaginatorModule,
    MatIconModule,
    DateInputComponent,
  ],
  templateUrl: './auditoria.component.html',
  styleUrl: './auditoria.component.css',
})
export class AuditoriaComponent extends AuditoriaStore {}
