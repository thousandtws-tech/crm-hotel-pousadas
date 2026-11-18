// UI de integracao-spedy — template, estilos e bindings. A lógica vive em integracao-spedy.store.ts.
import { DatePipe, JsonPipe } from '@angular/common';
import { Component } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { estadoDe } from './integracoes.const';
import { IntegracaoSpedyStore } from './integracao-spedy.store';

@Component({
  selector: 'app-integracao-spedy',
  imports: [ReactiveFormsModule, RouterLink, MatIconModule, DatePipe, JsonPipe],
  templateUrl: './integracao-spedy.component.html',
  styleUrl: './integracao-spedy.component.css',
})
export class IntegracaoSpedyComponent extends IntegracaoSpedyStore {}
