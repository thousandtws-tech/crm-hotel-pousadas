// UI de comunicacao — template, estilos e bindings. A lógica vive em comunicacao.store.ts.
import { Component } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Atendimento } from '@core/models/comunicacao.models';
import { ComunicacaoStore } from './comunicacao.store';

@Component({
  selector: 'app-comunicacao',
  imports: [FormsModule, DatePipe],
  templateUrl: './comunicacao.component.html',
  styleUrls: ['./comunicacao.component.css'],
})
export class ComunicacaoComponent extends ComunicacaoStore {}
