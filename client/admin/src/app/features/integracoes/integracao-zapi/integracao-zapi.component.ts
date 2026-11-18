// UI de integracao-zapi — template, estilos e bindings. A lógica vive em integracao-zapi.store.ts.
import { DatePipe } from '@angular/common';
import { Component } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { estadoDe } from '../integracoes/integracoes.const';
import { IntegracaoZapiStore } from './integracao-zapi.store';

@Component({
  selector: 'app-integracao-zapi',
  imports: [ReactiveFormsModule, RouterLink, MatIconModule, DatePipe],
  templateUrl: './integracao-zapi.component.html',
  styleUrl: './integracao-zapi.component.css',
})
export class IntegracaoZapiComponent extends IntegracaoZapiStore {}
