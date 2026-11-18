// UI de echart — template, estilos e bindings. A lógica vive em echart.store.ts.
import { Component, ElementRef, input, viewChild } from '@angular/core';
import { EChartStore, type EChartOption } from './echart.store';
export type { EChartOption };

@Component({
  selector: 'app-echart',
  templateUrl: './echart.component.html',
  styleUrl: './echart.component.css',
})
export class EChartComponent extends EChartStore {
  override readonly option = input.required<EChartOption>();
  override readonly rotulo = input<string>('Gráfico');
  protected override readonly el = viewChild.required<ElementRef<HTMLDivElement>>('el');
}
