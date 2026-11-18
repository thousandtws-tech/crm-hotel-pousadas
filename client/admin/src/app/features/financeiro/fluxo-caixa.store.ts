// Lógica e estado de fluxo-caixa — separada da camada de UI (fluxo-caixa.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { computed, inject, signal, OnInit, Directive } from '@angular/core';
import { FormControl, FormGroup } from '@angular/forms';
import { FinanceiroApi } from '@core/api/financeiro.api';
import { num } from '@core/utils/num';
import { FluxoCaixa } from '@core/models/financeiro.models';
import { Notify } from '@core/services/notify.service';
import { EChartOption } from '@shared/components/echart/echart.component';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmt = (v: string | number | null | undefined) => BRL.format(num(v));
const COMPACTO = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });

function isoLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function inicioMes(): string {
  const d = new Date();
  return isoLocal(new Date(d.getFullYear(), d.getMonth(), 1));
}
function fimMes(): string {
  const d = new Date();
  return isoLocal(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

@Directive()
export abstract class FinFluxoCaixaStore implements OnInit {
  private readonly financeiroApi = inject(FinanceiroApi);
  private readonly notify = inject(Notify);

  readonly fmt = fmt;
  readonly num = num;
  readonly fx = signal<FluxoCaixa | null>(null);

  readonly range = new FormGroup({
    inicio: new FormControl<Date | null>(
      new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    ),
    fim: new FormControl<Date | null>(
      new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
    ),
  });

  private ini = inicioMes();
  private fim = fimMes();

  readonly saldoFinalReal = computed(() => {
    const f = this.fx();
    if (!f) return '0';
    return String(num(f.saldo_abertura) + num(f.total_entradas) - num(f.total_saidas));
  });

  ngOnInit(): void {
    this.carregar();
  }

  aplicarRange(): void {
    const { inicio, fim } = this.range.value;
    if (inicio && fim) {
      this.ini = isoLocal(inicio);
      this.fim = isoLocal(fim);
      this.carregar();
    }
  }

  carregar(): void {
    this.fx.set(null);
    this.financeiroApi.fluxoCaixa(this.ini, this.fim).subscribe({
      next: (f) => this.fx.set(f),
      error: (e) => this.notify.erro(e),
    });
  }

  chartOption(): EChartOption {
    const f = this.fx();
    if (!f) return {};
    const dias = f.dias.map((d) => d.data.slice(8, 10) + '/' + d.data.slice(5, 7));
    return {
      tooltip: {
        trigger: 'axis',
        valueFormatter: (v: unknown) => BRL.format(Number(v)),
      },
      legend: { top: 0, textStyle: { color: '#5d6d7e', fontSize: 11 } },
      grid: { left: 8, right: 8, top: 34, bottom: 8, containLabel: true },
      xAxis: {
        type: 'category',
        data: dias,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: '#dbe4e9' } },
        axisLabel: { color: '#7d97a1', fontSize: 10 },
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          color: '#8fa3ab',
          fontSize: 11,
          formatter: (v: number) => COMPACTO.format(v),
        },
        splitLine: { lineStyle: { color: '#eef2f5' } },
      },
      series: [
        {
          name: 'Entradas',
          type: 'bar',
          stack: 'mov',
          barMaxWidth: 14,
          itemStyle: { color: '#1a6f8a', borderRadius: [0, 0, 0, 0] },
          data: f.dias.map((d) => num(d.entradas)),
        },
        {
          name: 'Saídas',
          type: 'bar',
          stack: 'mov2',
          barMaxWidth: 14,
          itemStyle: { color: '#b5811f' },
          data: f.dias.map((d) => num(d.saidas)),
        },
        {
          name: 'Acumulado',
          type: 'line',
          smooth: true,
          symbolSize: 5,
          lineStyle: { width: 2.4, color: '#054054' },
          itemStyle: { color: '#054054' },
          areaStyle: { color: 'rgba(5,64,84,0.06)' },
          data: f.dias.map((d) => num(d.acumulado)),
        },
      ],
    };
  }
}
