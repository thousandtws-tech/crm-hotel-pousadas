import {
  Component,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  inject,
  input,
  viewChild,
} from '@angular/core';
import * as echarts from 'echarts/core';
import { BarChart, GaugeChart, LineChart, PieChart } from 'echarts/charts';
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { ComposeOption } from 'echarts/core';
import type {
  BarSeriesOption,
  GaugeSeriesOption,
  LineSeriesOption,
  PieSeriesOption,
} from 'echarts/charts';
import type {
  GridComponentOption,
  LegendComponentOption,
  TooltipComponentOption,
} from 'echarts/components';

// Tree-shaking: só os módulos usados entram no bundle.
echarts.use([
  BarChart,
  GaugeChart,
  LineChart,
  PieChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

export type EChartOption = ComposeOption<
  | BarSeriesOption
  | GaugeSeriesOption
  | LineSeriesOption
  | PieSeriesOption
  | GridComponentOption
  | LegendComponentOption
  | TooltipComponentOption
>;

@Component({
  selector: 'app-echart',
  template: `<div #el class="ec-host" role="img" [attr.aria-label]="rotulo()"></div>`,
  styles: `.ec-host { display: block; width: 100%; height: 100%; min-height: 200px; }`,
})
export class EChartComponent {
  readonly option = input.required<EChartOption>();
  readonly rotulo = input<string>('Gráfico');
  private readonly el = viewChild.required<ElementRef<HTMLDivElement>>('el');
  private chart: echarts.ECharts | null = null;
  private ro: ResizeObserver | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.ro?.disconnect();
      this.chart?.dispose();
      this.chart = null;
    });
    afterRenderEffect(() => {
      const el = this.el().nativeElement;
      if (!this.chart) {
        this.chart = echarts.init(el);
        this.ro = new ResizeObserver(() => this.chart?.resize());
        this.ro.observe(el);
      }
      const opt = this.option();
      // notMerge:true reconstruía o gráfico inteiro a cada atualização.
      // replaceMerge troca só os componentes mudados e lazyUpdate agrupa
      // updates na mesma frame — updates de dados não dão reflow no canvas.
      this.chart.setOption(opt, {
        replaceMerge: ['xAxis', 'yAxis', 'series', 'grid', 'title', 'tooltip', 'legend'],
        lazyUpdate: true,
      });
    });
  }
}
