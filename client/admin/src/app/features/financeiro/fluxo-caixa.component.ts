import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { provideNativeDateAdapter } from '@angular/material/core';
import { ApiService, num } from '@core/services/api.service';
import { FluxoCaixa } from '@core/models/api.models';
import { Notify } from '@core/services/notify.service';
import { EChartComponent, EChartOption } from '@shared/components/echart.component';
import { FinNavComponent } from './fin-nav.component';

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

@Component({
  selector: 'app-fin-fluxo-caixa',
  providers: [provideNativeDateAdapter()],
  imports: [
    FinNavComponent,
    DatePipe,
    ReactiveFormsModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatDatepickerModule,
    EChartComponent,
  ],
  template: `
    <div class="page">
      <app-fin-nav />

      <div class="fin-head">
        <div>
          <h2 class="fin-titulo">Fluxo de caixa diário</h2>
          <p class="fin-sub">Realizado por dia + projeção dos vencimentos em aberto</p>
        </div>
        <div class="fin-periodo">
          <mat-form-field appearance="outline" subscriptSizing="dynamic" class="fin-range">
            <mat-date-range-input [rangePicker]="picker" [formGroup]="range">
              <input matStartDate formControlName="inicio" aria-label="Data inicial" />
              <input matEndDate formControlName="fim" aria-label="Data final" />
            </mat-date-range-input>
            <mat-datepicker-toggle matIconSuffix [for]="picker" />
            <mat-date-range-picker #picker (closed)="aplicarRange()" />
          </mat-form-field>
        </div>
      </div>

      @if (fx(); as f) {
        <div class="kpi">
          <div class="kpi-item">
            <span class="kpi-num">{{ fmt(f.saldo_abertura) }}</span>
            <span class="kpi-lbl"><mat-icon>account_balance_wallet</mat-icon> Abertura</span>
          </div>
          <div class="kpi-item">
            <span class="kpi-num pos">{{ fmt(f.total_entradas) }}</span>
            <span class="kpi-lbl"><mat-icon>arrow_downward</mat-icon> Entradas</span>
          </div>
          <div class="kpi-item">
            <span class="kpi-num neg">{{ fmt(f.total_saidas) }}</span>
            <span class="kpi-lbl"><mat-icon>arrow_upward</mat-icon> Saídas</span>
          </div>
          <div class="kpi-item">
            <span class="kpi-num" [class.neg]="num(saldoFinalReal()) < 0">{{ fmt(saldoFinalReal()) }}</span>
            <span class="kpi-lbl"><mat-icon>flag</mat-icon> Saldo final</span>
          </div>
          <div class="kpi-item">
            <span class="kpi-num" [class.neg]="num(f.saldo_final_previsto) < 0">{{ fmt(f.saldo_final_previsto) }}</span>
            <span class="kpi-lbl"><mat-icon>trending_up</mat-icon> Previsto c/ vencimentos</span>
          </div>
        </div>

        <section class="card">
          <header class="card-head">
            <h3>Movimento diário</h3>
            <small>Barras: entradas × saídas — linha: saldo acumulado</small>
          </header>
          <app-echart [option]="chartOption()" rotulo="Fluxo de caixa por dia" />
        </section>

        <section class="card">
          <header class="card-head"><h3>Detalhamento por dia</h3></header>
          <div class="tab-wrap">
            <table class="tab">
              <thead>
                <tr>
                  <th>Data</th>
                  <th class="tr">Entradas</th>
                  <th class="tr">Saídas</th>
                  <th class="tr">Saldo do dia</th>
                  <th class="tr">Acumulado</th>
                  <th class="tr">Prev. entradas</th>
                  <th class="tr">Prev. saídas</th>
                </tr>
              </thead>
              <tbody>
                @for (d of f.dias; track d.data) {
                  <tr>
                    <td>{{ d.data | date: 'EEE dd/MM' }}</td>
                    <td class="tr pos">{{ fmt(d.entradas) }}</td>
                    <td class="tr neg">{{ fmt(d.saidas) }}</td>
                    <td class="tr" [class.neg]="num(d.saldo) < 0">{{ fmt(d.saldo) }}</td>
                    <td class="tr fw" [class.neg]="num(d.acumulado) < 0">{{ fmt(d.acumulado) }}</td>
                    <td class="tr prev">{{ fmt(d.prev_entradas) }}</td>
                    <td class="tr prev">{{ fmt(d.prev_saidas) }}</td>
                  </tr>
                } @empty {
                  <tr><td colspan="7" class="vazio">Sem dados no período.</td></tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      } @else {
        <div class="skel sk-bloco"></div>
      }
    </div>
  `,
  styles: `
    .fin-head { display:flex; justify-content:space-between; align-items:flex-end; gap:12px; flex-wrap:wrap; padding-bottom:14px; margin-bottom:16px; border-bottom:1px solid #e3eaef; }
    .fin-titulo { margin:0; font-size:1.5rem; font-weight:800; color:#054054; letter-spacing:-.02em; }
    .fin-sub { margin:2px 0 0; font-size:.82rem; color:#7d97a1; }
    .fin-range { width:270px; }
    .kpi { display:flex; background:#fff; border:1px solid #e3eaef; border-radius:10px; margin-bottom:14px; overflow-x:auto; }
    .kpi-item { display:flex; flex-direction:column; gap:3px; padding:14px 24px; min-width:160px; border-left:1px solid #eef2f5; }
    .kpi-item:first-child { border-left:none; }
    .kpi-num { font-size:1.35rem; font-weight:800; color:#054054; line-height:1; letter-spacing:-.02em; font-variant-numeric:tabular-nums; white-space:nowrap; }
    .kpi-num.pos { color:#198754; } .kpi-num.neg, .neg { color:#dc3545; }
    .kpi-lbl { display:inline-flex; align-items:center; gap:5px; font-size:.68rem; font-weight:600; color:#7d97a1; text-transform:uppercase; letter-spacing:.07em; white-space:nowrap; }
    .kpi-lbl mat-icon { font-size:14px; width:14px; height:14px; color:#a5b6bf; }
    .card { background:#fff; border:1px solid #e3eaef; border-radius:10px; padding:16px 18px; margin-bottom:14px; }
    .card-head { display:flex; justify-content:space-between; align-items:baseline; gap:12px; margin-bottom:6px; }
    .card-head h3 { margin:0; font-size:.95rem; font-weight:700; color:#054054; }
    .card-head small { font-size:.74rem; color:#8a99a4; }
    .tab-wrap { overflow-x:auto; }
    .tab { width:100%; border-collapse:collapse; font-size:.88rem; }
    .tab thead th { background:#f4f8fa; color:#40525d; font-size:.73rem; font-weight:700; text-transform:uppercase; letter-spacing:.05em; padding:11px 14px; text-align:left; border-bottom:2px solid #e3eaef; white-space:nowrap; }
    .tab tbody td { padding:9px 14px; border-bottom:1px solid #eef2f5; color:#33424c; font-variant-numeric:tabular-nums; white-space:nowrap; }
    .tab .tr { text-align:right; }
    .pos { color:#198754; } .prev { color:#8a99a4; }
    .fw { font-weight:700; color:#054054; }
    .vazio { color:#8a99a4; font-size:.85rem; text-align:center; padding:22px 0; margin:0; }
    .skel { border-radius:8px; background:linear-gradient(90deg,#eef2f5 25%,#f7fafb 50%,#eef2f5 75%); background-size:200% 100%; animation:sk 1.2s infinite; }
    .sk-bloco { height:420px; }
    @keyframes sk { to { background-position:-200% 0; } }
  `,
})
export class FinFluxoCaixaComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly notify = inject(Notify);

  readonly fmt = fmt;
  readonly num = num;
  readonly fx = signal<FluxoCaixa | null>(null);

  readonly range = new FormGroup({
    inicio: new FormControl<Date | null>(new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
    fim: new FormControl<Date | null>(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0)),
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
    this.api.fluxoCaixa(this.ini, this.fim).subscribe({
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
