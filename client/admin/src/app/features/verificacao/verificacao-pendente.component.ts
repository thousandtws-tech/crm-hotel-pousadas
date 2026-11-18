// UI de verificacao-pendente — template, estilos e bindings. A lógica vive em verificacao-pendente.store.ts.
import { Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { VerificacaoPendenteStore } from './verificacao-pendente.store';

@Component({
  selector: 'app-verificacao-pendente',
  imports: [MatIconModule],
  templateUrl: './verificacao-pendente.component.html',
  styleUrl: './verificacao-pendente.component.css',
})
export class VerificacaoPendenteComponent extends VerificacaoPendenteStore {}
