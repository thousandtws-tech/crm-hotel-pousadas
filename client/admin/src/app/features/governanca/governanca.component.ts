// UI de governanca — template, estilos e bindings. A lógica vive em governanca.store.ts.
import { Component } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GovernancaStore } from './governanca.store';

@Component({
  selector: 'app-governanca',
  imports: [FormsModule, DatePipe],
  templateUrl: './governanca.component.html',
  styleUrls: ['./governanca.component.css'],
})
export class GovernancaComponent extends GovernancaStore {}
