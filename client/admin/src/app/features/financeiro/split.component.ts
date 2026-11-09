import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { DateInputComponent } from '@shared/components/date-input.component';
import { ApiService, num } from '@core/services/api.service';
import {
  SplitEventoView,
  SplitResumo,
  TributoApuracao,
  TributoConfig,
} from '@core/models/api.models';
import { Notify } from '@core/services/notify.service';
import { FinNavComponent } from './fin-nav.component';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmt = (v: string | number | null | undefined) => BRL.format(num(v));
const PCT = (v: string | number | null | undefined) =>
  `${num(v).toLocaleString('pt-BR', { maximumFractionDigits: 3 })}%`;

function isoLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

@Component({
  selector: 'app-fin-split',
  imports: [FinNavComponent, DatePipe, ReactiveFormsModule, MatIconModule, DateInputComponent],
  template: `
    <div class="page">
      <app-fin-nav />

      <div class="fin-head">
        <div>
          <h2 class="fin-titulo">Split payment — IBS/CBS</h2>
          <p class="fin-sub">Reforma tributária: segregação automática dos tributos sobre o recebimento</p>
        </div>
        <button type="button" class="btn-ghost" (click)="toggleConfig()">
          <mat-icon>tune</mat-icon> Alíquotas
        </button>
      </div>

      <!-- config vigente -->
      <section class="card cfg">
        <header class="card-head">
          <h3><mat-icon>percent</mat-icon> Alíquotas vigentes</h3>
          @if (config(); as c) {
            <small>Desde {{ c.vigente_desde | date: 'dd/MM/yyyy' }} · regime: {{ c.regime }}</small>
          }
        </header>
        @if (config(); as c) {
          <div class="cfg-nums">
            <div class="cfg-num"><strong>{{ PCT(c.aliq_ibs) }}</strong><span>IBS</span></div>
            <div class="cfg-num"><strong>{{ PCT(c.aliq_cbs) }}</strong><span>CBS</span></div>
            <div class="cfg-num"><strong>{{ PCT(num(c.aliq_ibs) + num(c.aliq_cbs)) }}</strong><span>Total segregado</span></div>
          </div>
        } @else {
          <p class="vazio">Sem configuração — cadastre as alíquotas para habilitar o split.</p>
        }
        @if (cfgAberto()) {
          <form class="cfg-form" [formGroup]="cfgForm" (ngSubmit)="salvarConfig()">
            <input class="inp" formControlName="aliq_ibs" type="number" step="0.001" min="0" placeholder="Alíquota IBS %" aria-label="Alíquota IBS em porcento" />
            <input class="inp" formControlName="aliq_cbs" type="number" step="0.001" min="0" placeholder="Alíquota CBS %" aria-label="Alíquota CBS em porcento" />
            <select class="inp" formControlName="regime" aria-label="Regime">
              <option value="split">Split payment</option>
              <option value="destaque">Destaque na nota</option>
            </select>
            <app-date class="inp-date" formControlName="vigente_desde" rotulo="Vigente desde" />
            <button class="btn-prim" type="submit" [disabled]="cfgForm.invalid">Salvar</button>
          </form>
        }
      </section>

      <!-- resumo do período -->
      @if (resumo(); as r) {
        <div class="kpi">
          <div class="kpi-item">
            <span class="kpi-num">{{ fmt(r.base) }}</span>
            <span class="kpi-lbl"><mat-icon>receipt</mat-icon> Base tributada</span>
          </div>
          <div class="kpi-item">
            <span class="kpi-num">{{ fmt(r.valor_ibs) }}</span>
            <span class="kpi-lbl"><mat-icon>account_balance</mat-icon> IBS</span>
          </div>
          <div class="kpi-item">
            <span class="kpi-num">{{ fmt(r.valor_cbs) }}</span>
            <span class="kpi-lbl"><mat-icon>account_balance</mat-icon> CBS</span>
          </div>
          <div class="kpi-item">
            <span class="kpi-num">{{ fmt(r.valor_liquido) }}</span>
            <span class="kpi-lbl"><mat-icon>payments</mat-icon> Líquido p/ pousada</span>
          </div>
          <div class="kpi-item">
            <span class="kpi-num ouro">{{ fmt(num(r.provisionado_ibs) + num(r.provisionado_cbs)) }}</span>
            <span class="kpi-lbl"><mat-icon>lock</mat-icon> Provisionado (não recolhido)</span>
          </div>
        </div>
      }

      <!-- apurações mensais -->
      <section class="card">
        <header class="card-head">
          <h3><mat-icon>calendar_month</mat-icon> Apurações mensais</h3>
          <button type="button" class="btn-ghost" (click)="toggleRecolher()">
            <mat-icon>task_alt</mat-icon> Fechar competência
          </button>
        </header>
        @if (recAberto()) {
          <form class="cfg-form" [formGroup]="recForm" (ngSubmit)="confirmarRecolher()">
            <input class="inp" formControlName="competencia" type="month" aria-label="Competência" />
            <button class="btn-prim" type="submit" [disabled]="recForm.invalid">Recolher</button>
            <button class="btn-ghost" type="button" (click)="recAberto.set(false)">Fechar</button>
          </form>
        }
        <div class="tab-wrap">
          <table class="tab">
            <thead>
              <tr><th>Competência</th><th class="tr">IBS</th><th class="tr">CBS</th><th class="tr">Total</th><th>Status</th></tr>
            </thead>
            <tbody>
              @for (a of apuracoes(); track a.id) {
                <tr>
                  <td class="nw">{{ a.competencia | date: 'MM/yyyy' }}</td>
                  <td class="tr">{{ fmt(a.valor_ibs) }}</td>
                  <td class="tr">{{ fmt(a.valor_cbs) }}</td>
                  <td class="tr fw">{{ fmt(num(a.valor_ibs) + num(a.valor_cbs)) }}</td>
                  <td><span class="st st-conc">{{ a.status === 'recolhido' ? 'Recolhido' : 'Provisionado' }}</span></td>
                </tr>
              } @empty {
                <tr><td colspan="5" class="vazio">Nenhuma apuração fechada ainda.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </section>

      <!-- eventos do split -->
      <section class="card">
        <header class="card-head">
          <h3><mat-icon>receipt_long</mat-icon> Eventos do período</h3>
          <small>{{ resumo()?.qtd_eventos ?? 0 }} eventos</small>
        </header>
        <div class="tab-wrap">
          <table class="tab">
            <thead>
              <tr>
                <th>Origem</th><th>Descrição</th><th>Competência</th>
                <th class="tr">Base</th><th class="tr">IBS</th><th class="tr">CBS</th><th class="tr">Líquido</th>
                <th class="tc">Status</th>
              </tr>
            </thead>
            <tbody>
              @for (e of eventos(); track e.id) {
                <tr>
                  <td><span class="chip">{{ e.origem === 'consumo' ? 'Consumo' : 'Baixa' }}</span></td>
                  <td class="td-desc">{{ e.descricao ?? '—' }}</td>
                  <td class="nw">{{ e.competencia | date: 'MM/yyyy' }}</td>
                  <td class="tr">{{ fmt(e.base) }}</td>
                  <td class="tr">{{ fmt(e.valor_ibs) }}</td>
                  <td class="tr">{{ fmt(e.valor_cbs) }}</td>
                  <td class="tr fw">{{ fmt(e.valor_liquido) }}</td>
                  <td class="tc"><span class="st" [class]="'st st-' + e.status">{{ e.status }}</span></td>
                </tr>
              } @empty {
                <tr><td colspan="8" class="vazio">Nenhum evento no período.</td></tr>
              }
            </tbody>
          </table>
        </div>
        <footer class="pag">
          <button type="button" class="btn-ghost" [disabled]="page() <= 1" (click)="pagina(page() - 1)">
            <mat-icon>chevron_left</mat-icon> Anterior
          </button>
          <span>{{ page() }} / {{ totalPaginas() }}</span>
          <button type="button" class="btn-ghost" [disabled]="page() >= totalPaginas()" (click)="pagina(page() + 1)">
            Próxima <mat-icon>chevron_right</mat-icon>
          </button>
        </footer>
      </section>
    </div>
  `,
  styles: `
    .fin-head { display:flex; justify-content:space-between; align-items:flex-end; gap:12px; flex-wrap:wrap; padding-bottom:14px; margin-bottom:16px; border-bottom:1px solid #e3eaef; }
    .fin-titulo { margin:0; font-size:1.5rem; font-weight:800; color:#054054; letter-spacing:-.02em; }
    .fin-sub { margin:2px 0 0; font-size:.82rem; color:#7d97a1; }
    .card { background:#fff; border:1px solid #e3eaef; border-radius:10px; padding:16px 18px; margin-bottom:14px; }
    .card-head { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:10px; }
    .card-head h3 { margin:0; font-size:.95rem; font-weight:700; color:#054054; display:inline-flex; align-items:center; gap:7px; }
    .card-head h3 mat-icon { font-size:18px; width:18px; height:18px; }
    .card-head small { font-size:.74rem; color:#8a99a4; }
    .btn-prim { display:inline-flex; align-items:center; gap:6px; background:#054054; color:#fff; border:none; border-radius:7px; padding:0 16px; min-height:34px; font-weight:600; font-size:.82rem; cursor:pointer; font-family:inherit; }
    .btn-prim:hover:not(:disabled) { background:#0a5a74; }
    .btn-prim:disabled { opacity:.55; }
    .btn-ghost { display:inline-flex; align-items:center; gap:5px; background:#fff; border:1px solid #d7e0e6; color:#5d6d7e; border-radius:7px; padding:0 12px; min-height:32px; font-weight:600; font-size:.8rem; cursor:pointer; font-family:inherit; }
    .btn-ghost:hover:not(:disabled) { border-color:#1a6f8a; color:#1a6f8a; }
    .inp { border:1px solid #d7e0e6; border-radius:7px; padding:8px 11px; font-size:.85rem; font-family:inherit; color:#33424c; background:#fff; }
    .inp:focus { outline:2px solid #1a6f8a33; border-color:#1a6f8a; }
    .cfg-nums { display:flex; gap:32px; flex-wrap:wrap; }
    .cfg-num { display:flex; flex-direction:column; }
    .cfg-num strong { font-size:1.5rem; font-weight:800; color:#054054; font-variant-numeric:tabular-nums; }
    .cfg-num span { font-size:.7rem; text-transform:uppercase; letter-spacing:.07em; color:#7d97a1; font-weight:600; }
    .cfg-form { display:flex; gap:8px; flex-wrap:wrap; margin-top:12px; padding-top:12px; border-top:1px dashed #e3eaef; }
    .cfg-form .inp { flex:1 1 150px; }
    .kpi { display:flex; background:#fff; border:1px solid #e3eaef; border-radius:10px; margin-bottom:14px; overflow-x:auto; }
    .kpi-item { display:flex; flex-direction:column; gap:3px; padding:14px 24px; min-width:160px; border-left:1px solid #eef2f5; }
    .kpi-item:first-child { border-left:none; }
    .kpi-num { font-size:1.3rem; font-weight:800; color:#054054; line-height:1; font-variant-numeric:tabular-nums; white-space:nowrap; }
    .kpi-num.ouro { color:#b98a45; }
    .kpi-lbl { display:inline-flex; align-items:center; gap:5px; font-size:.68rem; font-weight:600; color:#7d97a1; text-transform:uppercase; letter-spacing:.07em; white-space:nowrap; }
    .kpi-lbl mat-icon { font-size:14px; width:14px; height:14px; color:#a5b6bf; }
    .tab-wrap { overflow-x:auto; }
    .tab { width:100%; border-collapse:collapse; font-size:.88rem; }
    .tab thead th { background:#f4f8fa; color:#40525d; font-size:.73rem; font-weight:700; text-transform:uppercase; letter-spacing:.05em; padding:11px 14px; text-align:left; border-bottom:2px solid #e3eaef; white-space:nowrap; }
    .tab tbody td { padding:10px 14px; border-bottom:1px solid #eef2f5; color:#33424c; }
    .tab .tr { text-align:right; font-variant-numeric:tabular-nums; }
    .tab .tc { text-align:center; }
    .nw { white-space:nowrap; }
    .td-desc { font-weight:600; color:#054054; }
    .fw { font-weight:700; }
    .chip { font-size:.74rem; color:#5d6d7e; background:#eef4f6; border-radius:5px; padding:3px 9px; }
    .st { display:inline-block; font-size:.72rem; font-weight:700; border-radius:999px; padding:3px 11px; text-transform:capitalize; }
    .st-provisionado { background:#f7ead2; color:#9a6b00; }
    .st-segregado { background:#dbe9f5; color:#1a6f8a; }
    .st-recolhido { background:#dff2e5; color:#198754; }
    .st-conc { background:#dff2e5; color:#198754; }
    .pag { display:flex; align-items:center; justify-content:center; gap:14px; padding-top:12px; font-size:.82rem; color:#7d97a1; }
    .vazio { color:#8a99a4; font-size:.85rem; text-align:center; padding:18px 0; margin:0; }
  `,
})
export class FinSplitComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly notify = inject(Notify);

  readonly fmt = fmt;
  readonly num = num;
  readonly PCT = PCT;

  readonly config = signal<TributoConfig | null>(null);
  readonly resumo = signal<SplitResumo | null>(null);
  readonly eventos = signal<SplitEventoView[]>([]);
  readonly apuracoes = signal<TributoApuracao[]>([]);
  readonly cfgAberto = signal(false);
  readonly recAberto = signal(false);
  readonly page = signal(1);
  readonly total = signal(0);
  readonly totalPaginas = computed(() => Math.max(1, Math.ceil(this.total() / 20)));

  readonly cfgForm = new FormGroup({
    aliq_ibs: new FormControl<number | null>(null, { validators: [Validators.required, Validators.min(0)] }),
    aliq_cbs: new FormControl<number | null>(null, { validators: [Validators.required, Validators.min(0)] }),
    regime: new FormControl<'split' | 'destaque'>('split', { nonNullable: true }),
    vigente_desde: new FormControl(isoLocal(new Date()), { nonNullable: true }),
  });

  readonly recForm = new FormGroup({
    competencia: new FormControl(
      `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`,
      { nonNullable: true, validators: [Validators.required] },
    ),
  });

  ngOnInit(): void {
    this.carregar();
  }

  carregar(): void {
    this.api.tributoConfig().subscribe({
      next: (c) => this.config.set(c),
      error: (e) => this.notify.erro(e),
    });
    this.api.splitResumo().subscribe({
      next: (r) => this.resumo.set(r),
      error: (e) => this.notify.erro(e),
    });
    this.api.listarApuracoes().subscribe({
      next: (a) => this.apuracoes.set(a),
      error: () => undefined,
    });
    this.carregarEventos();
  }

  carregarEventos(): void {
    this.api.splitEventos(null, null, this.page()).subscribe({
      next: (p) => {
        this.eventos.set(p.items);
        this.total.set(p.total);
      },
      error: (e) => this.notify.erro(e),
    });
  }

  pagina(p: number): void {
    this.page.set(p);
    this.carregarEventos();
  }

  toggleConfig(): void {
    this.cfgAberto.update((v) => !v);
    const c = this.config();
    if (c) {
      this.cfgForm.patchValue({
        aliq_ibs: num(c.aliq_ibs),
        aliq_cbs: num(c.aliq_cbs),
        regime: c.regime === 'destaque' ? 'destaque' : 'split',
        vigente_desde: isoLocal(new Date()),
      });
    }
  }

  salvarConfig(): void {
    if (this.cfgForm.invalid) return;
    const v = this.cfgForm.getRawValue();
    this.api
      .criarTributoConfig({
        aliq_ibs: Number(v.aliq_ibs),
        aliq_cbs: Number(v.aliq_cbs),
        regime: v.regime,
        vigente_desde: v.vigente_desde,
      })
      .subscribe({
        next: () => {
          this.notify.ok('Alíquotas atualizadas.');
          this.cfgAberto.set(false);
          this.carregar();
        },
        error: (e) => this.notify.erro(e),
      });
  }

  toggleRecolher(): void {
    this.recAberto.update((v) => !v);
  }

  confirmarRecolher(): void {
    const mes = this.recForm.controls.competencia.value; // "yyyy-MM"
    if (!mes) return;
    this.api.recolherApuracao(`${mes}-01`).subscribe({
      next: (a) => {
        this.notify.ok(
          `Apuração ${mes} fechada: ${fmt(num(a.valor_ibs) + num(a.valor_cbs))} recolhidos.`,
        );
        this.recAberto.set(false);
        this.carregar();
      },
      error: (e) => this.notify.erro(e),
    });
  }
}
