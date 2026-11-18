// UI de inteligencia — template, estilos e bindings. A lógica vive em inteligencia.store.ts.
import { Component } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { InteligenciaStore } from './inteligencia.store';

@Component({
  selector: 'app-inteligencia',
  imports: [DatePipe, CurrencyPipe],
  templateUrl: './inteligencia.component.html',
  styleUrl: './inteligencia.component.css',
})
export class InteligenciaComponent extends InteligenciaStore {}
