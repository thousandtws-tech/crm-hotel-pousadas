// UI de manutencao — template, estilos e bindings. A lógica vive em manutencao.store.ts.
import { Component } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ManutencaoStore } from './manutencao.store';

@Component({
  selector: 'app-manutencao',
  imports: [FormsModule, DatePipe],
  templateUrl: './manutencao.component.html',
  styleUrls: ['./manutencao.component.css'],
})
export class ManutencaoComponent extends ManutencaoStore {}
