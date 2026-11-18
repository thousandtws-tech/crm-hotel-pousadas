// UI de recepcao — template, estilos e bindings. A lógica vive em recepcao.store.ts.
import { Component } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { RecepcaoStore } from './recepcao.store';

@Component({
  selector: 'app-recepcao',
  imports: [DatePipe, RouterLink, MatIconModule],
  templateUrl: './recepcao.component.html',
  styleUrl: './recepcao.component.css',
})
export class RecepcaoComponent extends RecepcaoStore {}
