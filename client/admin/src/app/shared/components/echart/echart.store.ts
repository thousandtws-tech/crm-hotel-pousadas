// Lógica e estado de echart — separada da camada de UI (echart.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { DestroyRef, ElementRef, afterRenderEffect, inject } from '@angular/core';
import * as echarts from 'echarts/core';
import { BarChart, GaugeChart, LineChart, PieChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
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
import type { InputSignal, Signal } from '@angular/core';
import { Directive } from '@angular/core';

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

@Directive()
export abstract class EChartStore {
  declare protected readonly option: InputSignal<EChartOption>;
  declare protected readonly rotulo: InputSignal<string>;
  declare protected readonly el: Signal<ElementRef<HTMLDivElement>>;

  private chart: echarts.ECharts | null = null;
  private ro: ResizeObserver | null = null;
  private rafResize = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      if (this.rafResize) cancelAnimationFrame(this.rafResize);
      this.ro?.disconnect();
      this.chart?.dispose();
      this.chart = null;
    });
    afterRenderEffect(() => {
      const el = this.el().nativeElement;
      if (!this.chart) {
        this.chart = echarts.init(el);
        // rAF: coalesce rajadas e tira o resize do "main process" do
        // setOption — chamá-lo ali dentro dispara warning do ECharts.
        this.ro = new ResizeObserver(() => {
          if (this.rafResize) return;
          this.rafResize = requestAnimationFrame(() => {
            this.rafResize = 0;
            this.chart?.resize();
          });
        });
        this.ro.observe(el);
      }
      const opt = this.option();
      // notMerge:true reconstruía o gráfico inteiro a cada atualização.
      // replaceMerge troca só os componentes mudados e lazyUpdate agrupa
      // updates na mesma frame — updates de dados não dão reflow no canvas.
      this.chart.setOption(opt, {
        replaceMerge: ['xAxis', 'yAxis', 'series', 'grid', 'tooltip', 'legend'],
        lazyUpdate: true,
      });
    });
  }
}
