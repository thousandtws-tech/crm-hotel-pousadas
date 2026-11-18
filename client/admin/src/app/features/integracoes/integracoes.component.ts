// UI de integracoes — template, estilos e bindings. A lógica vive em integracoes.store.ts.
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { estadoDe, rotuloAmbiente, rotuloProvedor } from './integracoes.const';
import { IntegracoesStore } from './integracoes.store';

@Component({
  selector: 'app-integracoes',
  imports: [RouterLink, MatIconModule],
  templateUrl: './integracoes.component.html',
  styleUrl: './integracoes.component.css',
})
export class IntegracoesComponent extends IntegracoesStore {}
