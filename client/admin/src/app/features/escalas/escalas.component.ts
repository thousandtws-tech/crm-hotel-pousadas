// UI de escalas — template, estilos e bindings. A lógica vive em escalas.store.ts.
import { Component } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EscalasStore } from './escalas.store';

@Component({
  selector: 'app-escalas',
  imports: [FormsModule, DatePipe],
  templateUrl: './escalas.component.html',
  styleUrls: ['./escalas.component.css'],
})
export class EscalasComponent extends EscalasStore {}
