// Lógica e estado de financeiro — separada da camada de UI (financeiro.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { computed, inject, signal, OnInit, effect, Directive } from '@angular/core';
import { FormControl, FormGroup } from '@angular/forms';
import { debounceTime } from 'rxjs';
import { RelatoriosApi } from '@core/api/relatorios.api';
import { STATUS_RESERVA } from '@core/models/reservas.models';
import { num } from '@core/utils/num.utils';
import {
  ItemMaisVendido,
  PontoSerie,
  ResumoFinanceiro,
  VendaItem,
} from '@core/models/relatorios.models';
import { ReservaResumo } from '@core/models/reservas.models';
import { NotifyService } from '@core/services/notify.service';
import { RealtimeService } from '@core/services/realtime.service';
import { TourService } from '@core/services/tour.service';
import { EChartOption } from '@shared/components/echart/echart.component';

type Preset = 'mes' | 'mesAnt' | 'd30' | 'ano' | 'custom';

/** Paleta oficial da pousada aplicada aos gráficos. */
const C = {
  navy: '#054054',
  teal: '#1a6f8a',
  light: '#4b95ab',
  gold: '#b5811f',
  cinza: '#8a99a4',
};
const PALETA = ['#054054', '#1a6f8a', '#4b95ab', '#b5811f', '#7fb8c9', '#b98a45', '#9fb9c4'];

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const COMPACTO = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });

/** ISO local — toISOString() converte para UTC e vira o dia em fuso negativo. */
function isoLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function axisCategoria(): Record<string, unknown> {
  return {
    type: 'category',
    axisTick: { show: false },
    axisLine: { lineStyle: { color: '#dbe4e9' } },
    axisLabel: { color: '#7d97a1', fontSize: 11 },
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

/** Formatter de tooltip de item — recebe o param cru do ECharts. */
function ttItem(fmtExtra: (p: { name: string; value: number; dataIndex: number }) => string) {
  return (p: unknown) => fmtExtra(p as { name: string; value: number; dataIndex: number });
}

@Directive()
export abstract class FinanceiroStore implements OnInit {
  private readonly relatoriosApi = inject(RelatoriosApi);
  private readonly notify = inject(NotifyService);
  private readonly rt = inject(RealtimeService);
  private readonly tour = inject(TourService);

  protected readonly num = num;
  protected readonly fmt = (v: number) => BRL.format(v);
  protected readonly skel = [0, 1, 2, 3];

  // ---------------- estado ----------------
  protected readonly preset = signal<Preset>('mes');
  protected readonly ini = signal('');
  protected readonly fim = signal('');
  protected readonly carregando = signal(true);

  protected readonly resumo = signal<ResumoFinanceiro | null>(null);
  protected readonly reservas = signal<ReservaResumo[]>([]);
  protected readonly vendasItens = signal<VendaItem[]>([]);
  protected readonly itensVendidos = signal<ItemMaisVendido[]>([]);
  protected readonly serieRecebido = signal<PontoSerie[]>([]);
  protected readonly serieReservasFat = signal<PontoSerie[]>([]);
  protected readonly serieVendas = signal<PontoSerie[]>([]);
  protected readonly seriePagamento = signal<PontoSerie[]>([]);
  protected readonly serieAcomodacao = signal<PontoSerie[]>([]);

  protected readonly range = new FormGroup({
    inicio: new FormControl<Date | null>(null),
    fim: new FormControl<Date | null>(null),
  });

  constructor() {
    let ultimo = -1;
    effect(() => {
      const v = this.rt.mudanca(
        'reserva',
        'consumo',
        'item_consumido',
        'adicional_consumo',
        'pagamento',
      );
      if (ultimo < 0) {
        ultimo = v;
        return;
      }
      if (v !== ultimo) {
        ultimo = v;
        this.carregar();
      }
    });
    this.range.valueChanges.pipe(debounceTime(250)).subscribe(({ inicio, fim }) => {
      if (inicio && fim && inicio <= fim) {
        this.preset.set('custom');
        this.ini.set(isoLocal(inicio));
        this.fim.set(isoLocal(fim));
        this.carregar();
      }
    });
  }

  ngOnInit(): void {
    this.aplicarPreset('mes');
  }

  // ---------------- período ----------------
  aplicarPreset(p: Exclude<Preset, 'custom'>): void {
    const h = new Date();
    let ini: Date;
    let fim: Date;
    switch (p) {
      case 'mes':
        ini = new Date(h.getFullYear(), h.getMonth(), 1);
        fim = new Date(h.getFullYear(), h.getMonth() + 1, 0);
        break;
      case 'mesAnt':
        ini = new Date(h.getFullYear(), h.getMonth() - 1, 1);
        fim = new Date(h.getFullYear(), h.getMonth(), 0);
        break;
      case 'd30':
        fim = h;
        ini = new Date(h);
        ini.setDate(ini.getDate() - 29);
        break;
      case 'ano':
        ini = new Date(h.getFullYear(), 0, 1);
        fim = new Date(h.getFullYear(), 11, 31);
        break;
    }
    this.preset.set(p);
    this.ini.set(isoLocal(ini));
    this.fim.set(isoLocal(fim));
    this.range.setValue({ inicio: ini, fim }, { emitEvent: false });
    this.carregar();
  }

  // ---------------- carga ----------------
  private carregar(): void {
    const i = this.ini();
    const f = this.fim();
    this.carregando.set(true);
    // 1 request consolidada — o servidor resolve as 8 leituras em paralelo.
    this.relatoriosApi.painelCompleto(i, f).subscribe({
      next: (p) => {
        this.resumo.set(p.resumo);
        this.serieRecebido.set(p.serie_recebido);
        this.serieReservasFat.set(p.serie_reservas);
        this.serieVendas.set(p.serie_vendas);
        this.seriePagamento.set(p.serie_por_pagamento);
        this.serieAcomodacao.set(p.serie_por_acomodacao);
        this.itensVendidos.set(p.itens_mais_vendidos);
        this.vendasItens.set(p.vendas);
        this.reservas.set(p.reservas);
        this.carregando.set(false);
      },
      error: (e) => {
        this.notify.erro(e);
        this.carregando.set(false);
      },
    });
  }

  // ---------------- derivados ----------------
  protected readonly ticketMedio = computed(() => {
    const r = this.resumo();
    const q = r?.qtd_contas_fechadas ?? 0;
    return q > 0 ? num(r?.recebido_contas) / q : 0;
  });
  protected readonly totalRecebido = computed(() =>
    this.serieRecebido().reduce((s, p) => s + num(p.valor), 0),
  );
  protected readonly totalVendas = computed(() =>
    this.serieVendas().reduce((s, p) => s + num(p.valor), 0),
  );
  protected readonly totalItens = computed(() =>
    this.itensVendidos().reduce((s, i) => s + i.quantidade, 0),
  );
  protected readonly temComposicao = computed(() => {
    const r = this.resumo();
    return (
      num(r?.recebido_estadias) +
        num(r?.recebido_itens) +
        num(r?.recebido_adicionais) +
        num(r?.recebido_online) >
      0
    );
  });

  // ---------------- opções ECharts ----------------
  protected readonly optFluxo = computed<EChartOption>(() => ({
    color: [C.teal, C.gold],
    tooltip: { ...TOOLTIP_BRL, trigger: 'axis' },
    legend: {
      top: 0,
      right: 0,
      icon: 'roundRect',
      itemWidth: 14,
      itemHeight: 8,
      textStyle: { color: '#5d6d7e', fontSize: 11 },
    },
    grid: { left: 8, right: 12, top: 34, bottom: 4, containLabel: true },
    xAxis: { ...axisCategoria(), data: this.serieRecebido().map((p) => p.rotulo) },
    yAxis: axisValor(),
    series: [
      {
        name: 'Recebido (caixa)',
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: { width: 2.5, color: C.teal },
        itemStyle: { color: C.teal },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(26,111,138,0.28)' },
              { offset: 1, color: 'rgba(26,111,138,0.02)' },
            ],
          },
        },
        data: this.serieRecebido().map((p) => num(p.valor)),
      },
      {
        name: 'Estadias faturadas',
        type: 'line',
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 2, color: C.gold, type: 'dashed' },
        itemStyle: { color: C.gold },
        data: this.serieReservasFat().map((p) => num(p.valor)),
      },
    ],
  }));

  protected readonly optComposicao = computed<EChartOption>(() => {
    const r = this.resumo();
    return {
      color: [C.teal, C.gold, C.light, C.navy],
      tooltip: { trigger: 'item', valueFormatter: (v: unknown) => BRL.format(Number(v)) },
      legend: {
        bottom: 0,
        icon: 'circle',
        itemWidth: 9,
        itemHeight: 9,
        textStyle: { color: '#5d6d7e', fontSize: 11 },
      },
      series: [
        {
          type: 'pie',
          radius: ['52%', '76%'],
          center: ['50%', '44%'],
          avoidLabelOverlap: true,
          itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
          label: {
            show: true,
            formatter: '{d}%',
            fontSize: 11,
            fontWeight: 600,
            color: '#40525d',
          },
          labelLine: { length: 8, length2: 8 },
          data: [
            { name: 'Estadias', value: num(r?.recebido_estadias) },
            { name: 'Itens e consumo', value: num(r?.recebido_itens) },
            { name: 'Adicionais', value: num(r?.recebido_adicionais) },
            { name: 'Pagamentos online', value: num(r?.recebido_online) },
          ],
        },
      ],
    };
  });

  protected readonly optPagamento = computed<EChartOption>(() => ({
    color: PALETA,
    tooltip: { trigger: 'item', valueFormatter: (v: unknown) => BRL.format(Number(v)) },
    legend: {
      bottom: 0,
      icon: 'circle',
      itemWidth: 9,
      itemHeight: 9,
      textStyle: { color: '#5d6d7e', fontSize: 11 },
    },
    series: [
      {
        type: 'pie',
        radius: ['52%', '76%'],
        center: ['50%', '44%'],
        itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
        label: {
          show: true,
          formatter: '{d}%',
          fontSize: 11,
          fontWeight: 600,
          color: '#40525d',
        },
        labelLine: { length: 8, length2: 8 },
        data: this.seriePagamento().map((p) => ({
          name: p.rotulo,
          value: num(p.valor),
        })),
      },
    ],
  }));

  protected readonly optAcomodacao = computed<EChartOption>(() => {
    const dados = [...this.serieAcomodacao()].sort((a, b) => num(a.valor) - num(b.valor));
    return {
      tooltip: { ...TOOLTIP_BRL, trigger: 'item' },
      grid: { left: 8, right: 84, top: 8, bottom: 8, containLabel: true },
      xAxis: { ...axisValor(), splitLine: { show: false }, axisLabel: { show: false } },
      yAxis: {
        ...axisCategoria(),
        axisLine: { show: false },
        axisLabel: { color: '#40525d', fontSize: 12 },
        data: dados.map((p) => p.rotulo),
      },
      series: [
        {
          type: 'bar',
          barWidth: 16,
          itemStyle: { color: C.teal, borderRadius: [0, 7, 7, 0] },
          label: {
            show: true,
            position: 'right',
            fontSize: 11,
            fontWeight: 600,
            color: C.navy,
            formatter: (p: unknown) => BRL.format(Number((p as { value: unknown }).value)),
          },
          data: dados.map((p) => num(p.valor)),
        },
      ],
    };
  });

  protected readonly optVendas = computed<EChartOption>(() => ({
    tooltip: TOOLTIP_BRL,
    grid: { left: 8, right: 12, top: 18, bottom: 4, containLabel: true },
    xAxis: { ...axisCategoria(), data: this.serieVendas().map((p) => p.rotulo) },
    yAxis: axisValor(),
    series: [
      {
        name: 'Vendas',
        type: 'bar',
        barWidth: '55%',
        itemStyle: { color: C.gold, borderRadius: [5, 5, 0, 0] },
        data: this.serieVendas().map((p) => num(p.valor)),
      },
    ],
  }));

  protected readonly optItens = computed<EChartOption>(() => {
    const dados = [...this.itensVendidos()].sort((a, b) => a.quantidade - b.quantidade).slice(-10);
    return {
      tooltip: {
        trigger: 'item',
        formatter: ttItem(
          (p) =>
            `${p.name}<br/><b>${p.value} unid.</b> · ${BRL.format(num(dados[p.dataIndex]?.valor))}`,
        ),
      },
      grid: { left: 8, right: 56, top: 8, bottom: 8, containLabel: true },
      xAxis: { type: 'value', splitLine: { show: false }, axisLabel: { show: false } },
      yAxis: {
        ...axisCategoria(),
        axisLine: { show: false },
        axisLabel: { color: '#40525d', fontSize: 12 },
        data: dados.map((i) => i.nome),
      },
      series: [
        {
          type: 'bar',
          barWidth: 16,
          itemStyle: { color: C.navy, borderRadius: [0, 7, 7, 0] },
          label: {
            show: true,
            position: 'right',
            fontSize: 11,
            fontWeight: 600,
            color: '#40525d',
            formatter: '{c}',
          },
          data: dados.map((i) => i.quantidade),
        },
      ],
    };
  });

  // ---------------- helpers ----------------
  iniciais(nome: string | null | undefined): string {
    if (!nome) return '?';
    const p = nome.trim().split(/\s+/);
    return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
  }
  statusRotulo(s: string): string {
    return STATUS_RESERVA[s as keyof typeof STATUS_RESERVA]?.rotulo ?? s;
  }
  statusCor(s: string): string {
    return STATUS_RESERVA[s as keyof typeof STATUS_RESERVA]?.cor ?? '#7d97a1';
  }
  statusTexto(s: string): string {
    return STATUS_RESERVA[s as keyof typeof STATUS_RESERVA]?.texto ?? '#fff';
  }

  /** Tour guiado da tela (driver.js). */
  iniciarTour(): void {
    this.tour.iniciar([
      {
        popover: {
          title: 'Bem-vindo ao Financeiro!',
          description:
            'O painel de resultados da pousada — todos os gráficos respondem ' +
            'ao mesmo período escolhido no topo. Avance com <b>Próximo</b>.',
        },
      },
      {
        element: '.fin-periodo-card',
        popover: {
          title: 'Período da análise',
          description:
            'Use os <b>atalhos</b> (este mês, mês passado…) ou escolha datas ' +
            'livres no calendário. Ao trocar, <b>todos</b> os números e ' +
            'gráficos da tela são recalculados.',
          side: 'bottom',
        },
      },
      {
        element: '#tour-kpis',
        popover: {
          title: 'Os números-chave',
          description:
            '<b>Recebido</b> = dinheiro que entrou · <b>Previsto</b> = a receber ' +
            '· <b>Descontos</b> concedidos · <b>Contas fechadas</b> e o ' +
            '<b>ticket médio</b> por conta.',
          side: 'bottom',
        },
      },
      {
        element: '#tour-fluxo',
        popover: {
          title: 'Receita no período',
          description:
            'A linha <b>teal</b> mostra o que entrou no caixa por dia; a linha ' +
            '<b>dourada tracejada</b> mostra o faturamento em reservas. Passe ' +
            'o mouse para ver valores exatos.',
          side: 'bottom',
        },
      },
      {
        element: '.fin-grid',
        popover: {
          title: 'Análises visuais',
          description:
            '<b>Composição</b> mostra de onde veio a receita · <b>pagamentos</b> ' +
            'mostra PIX, cartão, dinheiro… · os <b>rankings</b> revelam qual ' +
            'acomodação e quais itens mais vendem.',
          side: 'top',
        },
      },
      {
        element: '#tour-tabelas',
        popover: {
          title: 'Detalhamento',
          description:
            'Nas abas ficam as <b>reservas</b> e as <b>vendas</b> que formam ' +
            'os números — cada linha abre a reserva correspondente.',
          side: 'top',
        },
      },
      {
        popover: {
          title: 'Pronto!',
          description:
            'Feche o caixa no fim do mês escolhendo "Mês passado" e confira ' +
            'recebido × previsto. Tudo atualiza sozinho em tempo real.',
        },
      },
    ]);
  }
}
