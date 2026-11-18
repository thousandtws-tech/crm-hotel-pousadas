// UI de integracao-detalhe — template, estilos e bindings. A lógica vive em integracao-detalhe.store.ts.
import { DatePipe } from '@angular/common';
import { Component } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { estadoDe, rotuloAmbiente, rotuloProvedor } from './integracoes.const';
import { IntegracaoDetalheStore } from './integracao-detalhe.store';

@Component({
  selector: 'app-integracao-detalhe',
  imports: [ReactiveFormsModule, RouterLink, MatIconModule, DatePipe],
  templateUrl: './integracao-detalhe.component.html',
  styleUrl: './integracao-detalhe.component.css',
})
export class IntegracaoDetalheComponent extends IntegracaoDetalheStore {}
