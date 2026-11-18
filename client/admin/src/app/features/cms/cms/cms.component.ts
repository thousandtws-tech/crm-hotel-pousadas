// UI de cms — template, estilos e bindings. A lógica vive em cms.store.ts.
import { Component, viewChild, ElementRef } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { num } from '@core/utils/num';
import * as M from '@core/models';
import { CmsStore } from './cms.store';

@Component({
  selector: 'app-cms',
  host: {
    '(document:keydown.escape)': 'onEsc()',
    '(document:keydown.arrowleft)': 'onSeta(-1)',
    '(document:keydown.arrowright)': 'onSeta(1)',
  },
  imports: [DecimalPipe, ReactiveFormsModule, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './cms.component.html',
  styleUrls: ['./cms.component.css', './cms.extra.css'],
})
export class CmsComponent extends CmsStore {
  protected override readonly lightboxEl = viewChild<ElementRef<HTMLElement>>('lightbox');
}
