import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { provideNativeDateAdapter } from '@angular/material/core';
import { FinanceiroApi } from '@core/api/financeiro.api';
import { num } from '@core/utils/num';
import { Dre, GrupoDre } from '@core/models/financeiro.models';
import { Notify } from '@core/services/notify.service';
import { FinNavComponent } from './fin-nav.component';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmt = (v: string | number | null | undefined) => BRL.format(num(v));

function isoLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const ROTULO_GRUPO: Record<GrupoDre, string> = {
  receita_bruta: 'Receita bruta',
  deducoes: 'Deduções',
  custos: 'Custos',
  despesas_operacionais: 'Despesas operacionais',
  resultado_financeiro: 'Resultado financeiro',
  outras: 'Outras receitas/despesas',
};

interface LinhaDre {
  rotulo: string;
  valor: number;
  estilo: 'item' | 'subtotal' | 'destaque';
  sinal?: number; // -1 para dedução visual
}

@Component({
  selector: 'app-fin-dre',
  providers: [provideNativeDateAdapter()],
  imports: [
    FinNavComponent,
    DatePipe,
    ReactiveFormsModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatDatepickerModule,
  ],
  template: `
    <div class="page">
      <app-fin-nav />

      <div class="fin-head">
        <div>
          <h2 class="fin-titulo">DRE — Demonstrativo de Resultados</h2>
          <p class="fin-sub">Regime de competência (por competência/vencimento)</p>
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

      @if (dre(); as d) {
        <div class="kpi" [class.neg]="num(d.resultado_liquido) < 0">
          <div class="kpi-item">
            <span class="kpi-num">{{ fmt(d.resultado_liquido) }}</span>
            <span class="kpi-lbl"><mat-icon>emoji_events</mat-icon> Resultado líquido</span>
          </div>
          <div class="kpi-item">
            <span class="kpi-num">{{ margem() }}%</span>
            <span class="kpi-lbl"><mat-icon>percent</mat-icon> Margem líquida</span>
          </div>
          <div class="kpi-item">
            <span class="kpi-num">{{ fmt(d.ibs) }}</span>
            <span class="kpi-lbl"><mat-icon>account_balance</mat-icon> IBS provisionado</span>
          </div>
          <div class="kpi-item">
            <span class="kpi-num">{{ fmt(d.cbs) }}</span>
            <span class="kpi-lbl"><mat-icon>account_balance</mat-icon> CBS provisionado</span>
          </div>
        </div>

        <section class="card">
          <header class="card-head">
            <h3>Estrutura do resultado</h3>
            <small>{{ d.inicio | date: 'dd/MM/yyyy' }} — {{ d.fim | date: 'dd/MM/yyyy' }}</small>
          </header>
          <table class="tab dre">
            <tbody>
              @for (l of estrutura(); track l.rotulo) {
                <tr [class]="'l-' + l.estilo">
                  <td>{{ l.rotulo }}</td>
                  <td class="tr" [class.neg]="l.valor < 0">
                    @if (l.sinal === -1) { (−{{ fmt(-l.valor) }}) } @else { {{ fmt(l.valor) }} }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </section>

        <section class="card">
          <header class="card-head">
            <h3>Detalhamento por conta</h3>
            <small>Plano de contas + itens operacionais da pousada</small>
          </header>
          <div class="tab-wrap">
            <table class="tab">
              <thead>
                <tr>
                  <th>Conta</th>
                  <th>Grupo</th>
                  <th class="tr">Valor</th>
                </tr>
              </thead>
              <tbody>
                @for (l of d.linhas; track $index) {
                  <tr>
                    <td>
                      @if (l.codigo) { <span class="cod">{{ l.codigo }}</span> }
                      {{ l.rotulo }}
                    </td>
                    <td><span class="chip">{{ ROTULO[l.grupo] }}</span></td>
                    <td class="tr fw" [class.neg]="num(l.valor) < 0">{{ fmt(l.valor) }}</td>
                  </tr>
                } @empty {
                  <tr><td colspan="3" class="vazio">Sem lançamentos no período.</td></tr>
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
    .fin-head { display:flex; justify-content:space-between; align-items:flex-end; gap:12px; flex-wrap:wrap; padding-bottom:14px; margin-bottom:16px; border-bottom:1px solid #e9ecf0; }
    .fin-titulo { margin:0; font-size:1.5rem; font-weight:800; color:#20242c; letter-spacing:-.02em; }
    .fin-sub { margin:2px 0 0; font-size:.82rem; color:#66707e; }
    .fin-range { width:270px; }
    .kpi { display:flex; background:#fff; border:1px solid #e9ecf0; border-radius:10px; margin-bottom:14px; overflow-x:auto; }
    .kpi-item { display:flex; flex-direction:column; gap:3px; padding:14px 24px; min-width:150px; border-left:1px solid #f0f2f5; }
    .kpi-item:first-child { border-left:none; }
    .kpi-num { font-size:1.35rem; font-weight:800; color:#20242c; line-height:1; letter-spacing:-.02em; font-variant-numeric:tabular-nums; white-space:nowrap; }
    .kpi-lbl { display:inline-flex; align-items:center; gap:5px; font-size:.68rem; font-weight:600; color:#66707e; text-transform:uppercase; letter-spacing:.07em; white-space:nowrap; }
    .kpi-lbl mat-icon { font-size:14px; width:14px; height:14px; color:#a5b6bf; }
    .card { background:#fff; border:1px solid #e9ecf0; border-radius:10px; padding:16px 18px; margin-bottom:14px; }
    .card-head { display:flex; justify-content:space-between; align-items:baseline; gap:12px; margin-bottom:10px; }
    .card-head h3 { margin:0; font-size:.95rem; font-weight:700; color:#20242c; }
    .card-head small { font-size:.74rem; color:#66707e; }
    .tab-wrap { overflow-x:auto; }
    .tab { width:100%; border-collapse:collapse; font-size:.9rem; }
    .tab thead th { background:#f5f7fa; color:#3d4552; font-size:.73rem; font-weight:700; text-transform:uppercase; letter-spacing:.05em; padding:11px 14px; text-align:left; border-bottom:2px solid #e9ecf0; white-space:nowrap; }
    .tab tbody td { padding:11px 14px; border-bottom:1px solid #f0f2f5; color:#3d4552; }
    .tab .tr { text-align:right; font-variant-numeric:tabular-nums; }
    .neg { color:#dc3545; }
    .dre td { padding:13px 16px; font-variant-numeric:tabular-nums; }
    .dre .l-subtotal td { font-weight:700; color:#20242c; background:#f5f7fa; border-top:1px solid #dde2e8; }
    .dre .l-destaque td { font-weight:800; color:#20242c; background:#e6f3ec; border-top:2px solid #2457a7; font-size:.98rem; }
    .cod { font-family:ui-monospace,monospace; font-size:.78rem; color:#66707e; margin-right:6px; }
    .chip { font-size:.74rem; color:#55606d; background:#f0f2f5; border-radius:5px; padding:3px 9px; white-space:nowrap; }
    .fw { font-weight:700; }
    .vazio { color:#66707e; font-size:.85rem; text-align:center; padding:22px 0; margin:0; }
    .skel { border-radius:8px; background:linear-gradient(90deg,#f0f2f5 25%,#f8f9fb 50%,#f0f2f5 75%); background-size:200% 100%; animation:sk 1.2s infinite; }
    .sk-bloco { height:420px; }
    @keyframes sk { to { background-position:-200% 0; } }
  `,
})
export class FinDreComponent implements OnInit {
  private readonly financeiroApi = inject(FinanceiroApi);
  private readonly notify = inject(Notify);

  readonly fmt = fmt;
  readonly num = num;
  readonly ROTULO = ROTULO_GRUPO;
  readonly dre = signal<Dre | null>(null);

  readonly range = new FormGroup({
    inicio: new FormControl<Date | null>(new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
    fim: new FormControl<Date | null>(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0)),
  });

  private ini = '';
  private fim = '';

  readonly margem = computed(() => {
    const d = this.dre();
    if (!d) return '0,0';
    const rl = num(d.receita_liquida);
    if (rl <= 0) return '0,0';
    const m = (num(d.resultado_liquido) / rl) * 100;
    return m.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  });

  readonly estrutura = computed<LinhaDre[]>(() => {
    const d = this.dre();
    if (!d) return [];
    const n = num;
    return [
      { rotulo: '(=) Receita bruta', valor: n(d.receita_bruta), estilo: 'subtotal' },
      { rotulo: '(−) Deduções (descontos, IBS, CBS…)', valor: -n(d.deducoes), estilo: 'item', sinal: -1 },
      { rotulo: '(=) Receita líquida', valor: n(d.receita_liquida), estilo: 'subtotal' },
      { rotulo: '(−) Custos', valor: -n(d.custos), estilo: 'item', sinal: -1 },
      { rotulo: '(−) Despesas operacionais', valor: -n(d.despesas_operacionais), estilo: 'item', sinal: -1 },
      { rotulo: '(=) Lucro operacional', valor: n(d.lucro_operacional), estilo: 'subtotal' },
      { rotulo: '(±) Resultado financeiro', valor: n(d.resultado_financeiro), estilo: 'item' },
      { rotulo: '(±) Outras receitas/despesas', valor: n(d.outras), estilo: 'item' },
      { rotulo: '(=) Resultado líquido do período', valor: n(d.resultado_liquido), estilo: 'destaque' },
    ];
  });

  ngOnInit(): void {
    const { inicio, fim } = this.range.value;
    if (inicio && fim) {
      this.ini = isoLocal(inicio);
      this.fim = isoLocal(fim);
    }
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
    this.dre.set(null);
    this.financeiroApi.dre(this.ini || undefined, this.fim || undefined).subscribe({
      next: (d) => this.dre.set(d),
      error: (e) => this.notify.erro(e),
    });
  }
}
