// UI de dre — template, estilos e bindings. A lógica vive em dre.store.ts.
import { Component } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { provideNativeDateAdapter } from '@angular/material/core';
import { num } from '@core/utils/num';
import { FinNavComponent } from './fin-nav.component';
import { FinDreStore } from './dre.store';

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
                    @if (l.sinal === -1) {
                      (−{{ fmt(-l.valor) }})
                    } @else {
                      {{ fmt(l.valor) }}
                    }
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
                      @if (l.codigo) {
                        <span class="cod">{{ l.codigo }}</span>
                      }
                      {{ l.rotulo }}
                    </td>
                    <td>
                      <span class="chip">{{ ROTULO[l.grupo] }}</span>
                    </td>
                    <td class="tr fw" [class.neg]="num(l.valor) < 0">{{ fmt(l.valor) }}</td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="3" class="vazio">Sem lançamentos no período.</td>
                  </tr>
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
    .fin-head {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: 12px;
      flex-wrap: wrap;
      padding-bottom: 14px;
      margin-bottom: 16px;
      border-bottom: 1px solid #e3eaef;
    }
    .fin-titulo {
      margin: 0;
      font-size: 1.5rem;
      font-weight: 800;
      color: #054054;
      letter-spacing: -0.02em;
    }
    .fin-sub {
      margin: 2px 0 0;
      font-size: 0.82rem;
      color: #7d97a1;
    }
    .fin-range {
      width: 270px;
    }
    .kpi {
      display: flex;
      background: #fff;
      border: 1px solid #e3eaef;
      border-radius: 10px;
      margin-bottom: 14px;
      overflow-x: auto;
    }
    .kpi-item {
      display: flex;
      flex-direction: column;
      gap: 3px;
      padding: 14px 24px;
      min-width: 150px;
      border-left: 1px solid #eef2f5;
    }
    .kpi-item:first-child {
      border-left: none;
    }
    .kpi-num {
      font-size: 1.35rem;
      font-weight: 800;
      color: #054054;
      line-height: 1;
      letter-spacing: -0.02em;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .kpi-lbl {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 0.68rem;
      font-weight: 600;
      color: #7d97a1;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      white-space: nowrap;
    }
    .kpi-lbl mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
      color: #a5b6bf;
    }
    .card {
      background: #fff;
      border: 1px solid #e3eaef;
      border-radius: 10px;
      padding: 16px 18px;
      margin-bottom: 14px;
    }
    .card-head {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 12px;
      margin-bottom: 10px;
    }
    .card-head h3 {
      margin: 0;
      font-size: 0.95rem;
      font-weight: 700;
      color: #054054;
    }
    .card-head small {
      font-size: 0.74rem;
      color: #8a99a4;
    }
    .tab-wrap {
      overflow-x: auto;
    }
    .tab {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
    }
    .tab thead th {
      background: #f4f8fa;
      color: #40525d;
      font-size: 0.73rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 11px 14px;
      text-align: left;
      border-bottom: 2px solid #e3eaef;
      white-space: nowrap;
    }
    .tab tbody td {
      padding: 11px 14px;
      border-bottom: 1px solid #eef2f5;
      color: #33424c;
    }
    .tab .tr {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .neg {
      color: #dc3545;
    }
    .dre td {
      padding: 13px 16px;
      font-variant-numeric: tabular-nums;
    }
    .dre .l-subtotal td {
      font-weight: 700;
      color: #054054;
      background: #f4f8fa;
      border-top: 1px solid #dbe4e9;
    }
    .dre .l-destaque td {
      font-weight: 800;
      color: #054054;
      background: #eaf4f0;
      border-top: 2px solid #1a6f8a;
      font-size: 0.98rem;
    }
    .cod {
      font-family: ui-monospace, monospace;
      font-size: 0.78rem;
      color: #7d97a1;
      margin-right: 6px;
    }
    .chip {
      font-size: 0.74rem;
      color: #5d6d7e;
      background: #eef4f6;
      border-radius: 5px;
      padding: 3px 9px;
      white-space: nowrap;
    }
    .fw {
      font-weight: 700;
    }
    .vazio {
      color: #8a99a4;
      font-size: 0.85rem;
      text-align: center;
      padding: 22px 0;
      margin: 0;
    }
    .skel {
      border-radius: 8px;
      background: linear-gradient(90deg, #eef2f5 25%, #f7fafb 50%, #eef2f5 75%);
      background-size: 200% 100%;
      animation: sk 1.2s infinite;
    }
    .sk-bloco {
      height: 420px;
    }
    @keyframes sk {
      to {
        background-position: -200% 0;
      }
    }
  `,
})
export class FinDreComponent extends FinDreStore {}
