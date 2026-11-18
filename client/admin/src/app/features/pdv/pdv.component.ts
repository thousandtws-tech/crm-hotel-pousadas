// UI de pdv — template, estilos e bindings. A lógica vive em pdv.store.ts.
import { Component, ElementRef, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { num } from '@core/utils/num';
import { PdvStore } from './pdv.store';

@Component({
  selector: 'app-pdv',
  host: { '(document:keydown.escape)': 'fecharModais()' },
  imports: [DatePipe, ReactiveFormsModule, MatIconModule],
  templateUrl: './pdv.component.html',
  styleUrls: ['./pdv.component.css', './pdv.extra.css'],
})
export class PdvComponent extends PdvStore {
  protected override readonly modalVoltar = viewChild<ElementRef<HTMLButtonElement>>('modalVoltar');
}
