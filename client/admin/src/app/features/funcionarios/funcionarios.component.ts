// UI de funcionarios — template, estilos e bindings. A lógica vive em funcionarios.store.ts.
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ReactiveFormsModule } from '@angular/forms';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import * as M from '@core/models';
import { Cargo } from '@core/models/funcionarios.models';
import { DateInputComponent } from '@shared/components/date-input.component';
import { FuncionariosStore } from './funcionarios.store';

@Component({
  selector: 'app-funcionarios',
  host: { '(document:keydown.escape)': 'onEsc()' },
  imports: [
    RouterLink,
    MatPaginatorModule,
    MatIconModule,
    MatFormFieldModule,
    MatSelectModule,
    ReactiveFormsModule,
    DateInputComponent,
  ],
  templateUrl: './funcionarios.component.html',
  styleUrl: './funcionarios.component.css',
})
export class FuncionariosComponent extends FuncionariosStore {}
