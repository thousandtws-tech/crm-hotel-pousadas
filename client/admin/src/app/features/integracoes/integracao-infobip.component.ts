// UI de integracao-infobip — template, estilos e bindings. A lógica vive em integracao-infobip.store.ts.
import { DatePipe } from '@angular/common';
import { Component } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { IntegracaoInfobipStore } from './integracao-infobip.store';

@Component({
  selector: 'app-integracao-infobip',
  imports: [ReactiveFormsModule, RouterLink, MatIconModule, DatePipe],
  templateUrl: './integracao-infobip.component.html',
  styleUrl: './integracao-infobip.component.css',
})
export class IntegracaoInfobipComponent extends IntegracaoInfobipStore {}
