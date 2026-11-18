// Lógica e estado de dashboard — separada da camada de UI (dashboard.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { computed, inject, signal, OnInit, effect, Directive } from '@angular/core';
import { RelatoriosApi } from '@core/api/relatorios.api';
import type { StatusReserva } from '@core/models/comum.models';
import { DashboardResponse, PontoSerie, ResumoFinanceiro } from '@core/models/relatorios.models';
import { NotifyService } from '@core/services/notify.service';
import { RealtimeService } from '@core/services/realtime.service';
import { TourService } from '@core/services/tour.service';
import { EChartOption } from '@shared/components/echart/echart.component';

type Preset = 'd7' | 'd30' | 'mes' | 'mesAnt';

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});
const COMPACTO = new Intl.NumberFormat('pt-BR', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

const num = (v: string | null | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** ISO local — toISOString() em UTC poderia virar o dia no fuso brasileiro. */
const isoLocal = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(
    2,
    '0',
  )}`;

function rangeDe(p: Preset): [Date, Date] {
  const fim = new Date();
  const ini = new Date();
  switch (p) {
    case 'd7':
      ini.setDate(ini.getDate() - 6);
      break;
    case 'd30':
      ini.setDate(ini.getDate() - 29);
      break;
    case 'mes':
      ini.setDate(1);
      break;
    case 'mesAnt':
      ini.setMonth(ini.getMonth() - 1, 1);
      fim.setDate(0);
      break;
  }
  return [ini, fim];
}

function axisCategoria(): Record<string, unknown> {
  return {
    type: 'category',
    boundaryGap: false,
    axisLine: { lineStyle: { color: '#dde6eb' } },
    axisTick: { show: false },
    axisLabel: { color: '#8fa3ab', fontSize: 11 },
  };
}
function axisValor(): Record<string, unknown> {
  return {
    type: 'value',
    axisLabel: {
      color: '#8fa3ab',
      fontSize: 11,
      formatter: (v: number) => COMPACTO.format(v),
    },
    splitLine: { lineStyle: { color: '#eef2f5' } },
  };
}
const TOOLTIP_BRL = {
  trigger: 'axis' as const,
  valueFormatter: (v: unknown) => BRL.format(Number(v)),
};
function ttItem(fmtExtra: (p: { name: string; value: number }) => string) {
  return (p: unknown) => fmtExtra(p as { name: string; value: number });
}

@Directive()
export abstract class DashboardStore implements OnInit {
  private readonly rt = inject(RealtimeService);
  private readonly relatoriosApi = inject(RelatoriosApi);
  private readonly notify = inject(NotifyService);
  private readonly tour = inject(TourService);

  protected readonly hoje = new Date();
  protected readonly carregandoOps = signal(true);
  protected readonly carregandoFin = signal(true);
  protected readonly dados = signal<DashboardResponse | null>(null);
  protected readonly resumo = signal<ResumoFinanceiro | null>(null);
  protected readonly serieRecebido = signal<PontoSerie[]>([]);
  protected readonly serieReservas = signal<PontoSerie[]>([]);
  protected readonly seriePagamento = signal<PontoSerie[]>([]);
  protected readonly serieAcomodacao = signal<PontoSerie[]>([]);
  protected readonly preset = signal<Preset>('d30');
  protected readonly ini = signal<Date>(new Date());
  protected readonly fim = signal<Date>(new Date());

  protected readonly ocupacao = computed(() => {
    const c = this.dados()?.cards;
    if (!c || !c.total_acomodacoes) return 0;
    return Math.round((c.acomodacoes_ocupadas / c.total_acomodacoes) * 100);
  });

  protected readonly totalRecebido = computed(() =>
    this.serieRecebido().reduce((acc, p) => acc + num(p.valor), 0),
  );

  constructor() {
    let ultimo = -1;
    effect(() => {
      const v = this.rt.mudanca('reserva', 'consumo', 'item_consumido', 'conta', 'pagamento');
      if (ultimo < 0) {
        ultimo = v;
        return;
      }
      if (v !== ultimo) {
        ultimo = v;
        this.carregarOps();
        this.carregarFin();
      }
    });
  }

  ngOnInit(): void {
    this.aplicar('d30');
    this.carregarOps();
  }

  aplicar(p: Preset): void {
    this.preset.set(p);
    const [i, f] = rangeDe(p);
    this.ini.set(i);
    this.fim.set(f);
    this.carregarFin();
  }

  carregarOps(): void {
    this.carregandoOps.set(true);
    this.relatoriosApi.dashboard().subscribe({
      next: (d) => {
        this.dados.set(d);
        this.carregandoOps.set(false);
      },
      error: (e) => {
        this.carregandoOps.set(false);
        this.notify.erro(e);
      },
    });
  }

  carregarFin(): void {
    this.carregandoFin.set(true);
    const i = isoLocal(this.ini());
    const f = isoLocal(this.fim());
    // 1 request consolidada — o backend resolve as 5 leituras em paralelo.
    this.relatoriosApi.painelFinanceiro(i, f).subscribe({
      next: (p) => {
        this.resumo.set(p.resumo);
        this.serieRecebido.set(p.serie_recebido);
        this.serieReservas.set(p.serie_reservas);
        this.seriePagamento.set(p.serie_por_pagamento);
        this.serieAcomodacao.set(p.serie_por_acomodacao);
        this.carregandoFin.set(false);
      },
      error: (e) => {
        this.notify.erro(e);
        this.carregandoFin.set(false);
      },
    });
  }

  /* ================= gráficos ================= */

  protected readonly optFluxo = computed<EChartOption>(() => ({
    tooltip: TOOLTIP_BRL,
    grid: { left: 6, right: 14, top: 18, bottom: 4, containLabel: true },
    xAxis: {
      ...axisCategoria(),
      data: this.serieRecebido().map((p) => p.rotulo),
    },
    yAxis: axisValor(),
    series: [
      {
        name: 'Recebido',
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 5,
        data: this.serieRecebido().map((p) => num(p.valor)),
        lineStyle: { color: '#1a6f8a', width: 2.5 },
        itemStyle: { color: '#1a6f8a' },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(26,111,138,0.22)' },
              { offset: 1, color: 'rgba(26,111,138,0.01)' },
            ],
          },
        },
      },
    ],
  }));

  protected readonly optOcupacao = computed<EChartOption>(() => ({
    series: [
      {
        type: 'gauge',
        startAngle: 205,
        endAngle: -25,
        min: 0,
        max: 100,
        radius: '100%',
        center: ['50%', '58%'],
        progress: {
          show: true,
          width: 15,
          roundCap: true,
          itemStyle: { color: '#054054' },
        },
        axisLine: {
          roundCap: true,
          lineStyle: { width: 15, color: [[1, '#e8eff3']] },
        },
        pointer: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        title: {
          show: true,
          offsetCenter: [0, '32%'],
          fontSize: 11,
          fontWeight: 600,
          color: '#7d97a1',
        },
        detail: {
          valueAnimation: true,
          fontSize: 38,
          fontWeight: 800,
          color: '#054054',
          offsetCenter: [0, '-4%'],
          formatter: '{value}%',
        },
        data: [{ value: this.ocupacao(), name: 'ACOMODAÇÕES OCUPADAS' }],
      },
    ],
  }));

  protected readonly optReservas = computed<EChartOption>(() => ({
    tooltip: {
      trigger: 'axis',
      formatter: ttItem((p) => `${p.name}<br/><b>${p.value}</b> reserva(s)`),
    },
    grid: { left: 6, right: 10, top: 14, bottom: 4, containLabel: true },
    xAxis: {
      ...axisCategoria(),
      boundaryGap: true,
      data: this.serieReservas().map((p) => p.rotulo),
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      axisLabel: { color: '#8fa3ab', fontSize: 11 },
      splitLine: { lineStyle: { color: '#eef2f5' } },
    },
    series: [
      {
        name: 'Reservas',
        type: 'bar',
        barMaxWidth: 18,
        data: this.serieReservas().map((p) => p.quantidade),
        itemStyle: { color: '#054054', borderRadius: [3, 3, 0, 0] },
      },
    ],
  }));

  protected readonly optAcomodacao = computed<EChartOption>(() => {
    const pts = [...this.serieAcomodacao()].reverse();
    return {
      tooltip: {
        trigger: 'item',
        formatter: ttItem((p) => `${p.name}<br/><b>${BRL.format(p.value)}</b>`),
      },
      grid: { left: 6, right: 70, top: 8, bottom: 4, containLabel: true },
      xAxis: {
        type: 'value',
        splitLine: { show: false },
        axisLabel: { show: false },
      },
      yAxis: {
        type: 'category',
        data: pts.map((p) => p.rotulo),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: '#5d6d7e', fontSize: 11 },
      },
      series: [
        {
          name: 'Receita',
          type: 'bar',
          barMaxWidth: 16,
          data: pts.map((p) => num(p.valor)),
          itemStyle: { color: '#1a6f8a', borderRadius: [0, 3, 3, 0] },
          label: {
            show: true,
            position: 'right',
            color: '#40525d',
            fontSize: 11,
            fontWeight: 600,
            formatter: (p: { value: unknown }) => BRL.format(Number(p.value)),
          },
        },
      ],
    };
  });

  protected readonly optPagamento = computed<EChartOption>(() => ({
    tooltip: {
      trigger: 'item',
      formatter: ttItem((p) => `${p.name}<br/><b>${BRL.format(p.value)}</b>`),
    },
    legend: {
      bottom: 0,
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { color: '#5d6d7e', fontSize: 11 },
    },
    series: [
      {
        name: 'Pagamento',
        type: 'pie',
        radius: ['52%', '76%'],
        center: ['50%', '44%'],
        avoidLabelOverlap: true,
        itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 2 },
        label: {
          show: true,
          formatter: '{d}%',
          fontSize: 11,
          color: '#40525d',
          fontWeight: 600,
        },
        data: this.seriePagamento().map((p, i) => ({
          name: p.rotulo,
          value: num(p.valor),
          itemStyle: {
            color: ['#054054', '#1a6f8a', '#4b95ab', '#8ab4c4', '#b9ccd4'][i % 5],
          },
        })),
      },
    ],
  }));

  /* ================= helpers ================= */

  fmt(v: number): string {
    return BRL.format(v);
  }
  num(v: string | null | undefined): number {
    return num(v);
  }

  /** Status na paleta da pousada (o STATUS_RESERVA global é do legado). */
  private readonly STATUS: Record<StatusReserva, { rotulo: string; bg: string; fg: string }> = {
    p: { rotulo: 'Pendente', bg: '#eef2f5', fg: '#8a6200' },
    i: { rotulo: 'Hospedado', bg: '#eef2f5', fg: '#1a6f8a' },
    f: { rotulo: 'Finalizado', bg: '#eef2f5', fg: '#40525d' },
    c: { rotulo: 'Cancelada', bg: '#eef2f5', fg: '#7d97a1' },
  };

  statusRotulo(s: string): string {
    return this.STATUS[s as StatusReserva]?.rotulo ?? s;
  }
  statusCor(s: string): string {
    return this.STATUS[s as StatusReserva]?.bg ?? '#eef2f5';
  }
  statusTexto(s: string): string {
    return this.STATUS[s as StatusReserva]?.fg ?? '#40525d';
  }

  iniciarTour(): void {
    this.tour.iniciar([
      {
        popover: {
          title: 'Bem-vindo ao Dashboard!',
          description:
            'A visão de raio-x da pousada — operação de <b>hoje</b> e resultado ' +
            'financeiro do <b>período</b> escolhido. Avance com <b>Próximo</b>.',
        },
      },
      {
        element: '#tour-slicer',
        popover: {
          title: 'Slicer de período',
          description:
            'Como no Power BI: este filtro controla <b>todos</b> os gráficos e ' +
            'os valores de Recebido/Previsto. Os números de chegadas, saídas e ' +
            'ocupação são sempre de <b>agora</b>.',
          side: 'bottom',
        },
      },
      {
        element: '#tour-kpis',
        popover: {
          title: 'Os tiles de indicadores',
          description:
            'Hóspedes na casa, <b>ocupação</b> com barra de progresso, ' +
            '<b>chegadas e saídas pendentes</b> (em dourado quando há ' +
            'pendência) e os valores financeiros do período.',
          side: 'bottom',
        },
      },
      {
        element: '#tour-receita',
        popover: {
          title: 'Receita e ocupação',
          description:
            'A área teal mostra o caixa por dia; o <b>medidor</b> ao lado ' +
            'mostra quantos quartos estão ocupados neste momento.',
          side: 'top',
        },
      },
      {
        element: '#tour-movimento',
        popover: {
          title: 'Movimento de hoje',
          description:
            'A lista de trabalho da recepção: <b>quem chega</b> e <b>quem sai</b>. ' +
            'Clique numa linha para abrir a reserva e fazer o check-in/check-out.',
          side: 'top',
        },
      },
      {
        element: '#tour-reservas',
        popover: {
          title: 'Últimas reservas',
          description:
            'As reservas mais recentes com situação e período. ' +
            '<b>Ver todas</b> leva ao módulo completo de Reservas.',
          side: 'top',
        },
      },
      {
        popover: {
          title: 'Pronto!',
          description:
            'Tudo atualiza <b>em tempo real</b>: um check-in feito em outra aba ' +
            'reflete aqui automaticamente. Bom turno!',
        },
      },
    ]);
  }
}
