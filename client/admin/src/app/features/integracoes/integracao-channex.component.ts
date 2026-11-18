// UI de integracao-channex — template, estilos e bindings. A lógica vive em integracao-channex.store.ts.
import { DatePipe } from '@angular/common';
import { Component } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { estadoDe, rotuloAmbiente } from './integracoes.const';
import { IntegracaoChannexStore } from './integracao-channex.store';

@Component({
  selector: 'app-integracao-channex',
  imports: [ReactiveFormsModule, RouterLink, MatIconModule, DatePipe],
  templateUrl: './integracao-channex.component.html',
  styleUrl: './integracao-channex.component.css',
})
export class IntegracaoChannexComponent extends IntegracaoChannexStore {}
