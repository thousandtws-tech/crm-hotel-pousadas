// UI de integracao-didit — template, estilos e bindings. A lógica vive em integracao-didit.store.ts.
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { estadoDe } from './integracoes.const';
import { IntegracaoDiditStore } from './integracao-didit.store';

@Component({
  selector: 'app-integracao-didit',
  imports: [RouterLink, ReactiveFormsModule, MatIconModule],
  templateUrl: './integracao-didit.component.html',
  styleUrl: './integracao-didit.component.css',
})
export class IntegracaoDiditComponent extends IntegracaoDiditStore {}
