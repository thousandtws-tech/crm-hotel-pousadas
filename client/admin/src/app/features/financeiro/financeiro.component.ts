// UI de financeiro — template, estilos e bindings. A lógica vive em financeiro.store.ts.
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { provideNativeDateAdapter } from '@angular/material/core';
import { MatTabsModule } from '@angular/material/tabs';
import { num } from '@core/utils/num';
import { EChartComponent } from '@shared/components/echart.component';
import { FinNavComponent } from './fin-nav.component';
import { FinanceiroStore } from './financeiro.store';

@Component({
  selector: 'app-financeiro',
  providers: [provideNativeDateAdapter()],
  imports: [
    RouterLink,
    DatePipe,
    ReactiveFormsModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatDatepickerModule,
    MatTabsModule,
    EChartComponent,
    FinNavComponent,
  ],
  template: `
    <div class="page">
      <app-fin-nav />
      <!-- ================= Cabeçalho editorial ================= -->
      <div class="fin-head">
        <div>
          <h2 class="fin-titulo">Financeiro</h2>
          <p class="fin-periodo">
            {{ ini() | date: "dd 'de' MMMM" }} — {{ fim() | date: "dd 'de' MMMM 'de' yyyy" }}
          </p>
        </div>
        <div class="fin-head-acoes">
          <button
            class="btn-tour"
            type="button"
            (click)="iniciarTour()"
            aria-label="Ver tutorial da tela"
          >
            <mat-icon>school</mat-icon> Tutorial
          </button>
        </div>
      </div>

      <!-- ================= Período ================= -->
      <div class="inner-card fin-periodo-card">
        <div class="fin-presets" role="group" aria-label="Períodos rápidos">
          <button
            type="button"
            class="pre-btn"
            [class.ativo]="preset() === 'mes'"
            (click)="aplicarPreset('mes')"
          >
            Este mês
          </button>
          <button
            type="button"
            class="pre-btn"
            [class.ativo]="preset() === 'mesAnt'"
            (click)="aplicarPreset('mesAnt')"
          >
            Mês passado
          </button>
          <button
            type="button"
            class="pre-btn"
            [class.ativo]="preset() === 'd30'"
            (click)="aplicarPreset('d30')"
          >
            Últimos 30 dias
          </button>
          <button
            type="button"
            class="pre-btn"
            [class.ativo]="preset() === 'ano'"
            (click)="aplicarPreset('ano')"
          >
            Este ano
          </button>
        </div>
        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="campo-mat fin-range">
          <mat-date-range-input [rangePicker]="picker" [formGroup]="range">
            <input
              matStartDate
              formControlName="inicio"
              placeholder="De"
              aria-label="Data inicial"
            />
            <input matEndDate formControlName="fim" placeholder="Até" aria-label="Data final" />
          </mat-date-range-input>
          <mat-datepicker-toggle matIconSuffix [for]="picker" />
          <mat-date-range-picker #picker />
        </mat-form-field>
      </div>

      <!-- ================= Barra de números ================= -->
      <div class="fin-resumo" id="tour-kpis">
        <div class="fin-est">
          <span class="fin-est-num">{{ fmt(num(resumo()?.recebido)) }}</span>
          <span class="fin-est-lbl"><mat-icon>payments</mat-icon> Recebido</span>
          @if (num(resumo()?.recebido_online) > 0) {
            <span
              class="fin-est-online"
              title="Cobranças online confirmadas (Pix/cartão antecipado) — entram na receita quando a estadia é faturada"
            >
              + {{ fmt(num(resumo()?.recebido_online)) }} online
            </span>
          }
        </div>
        <div class="fin-est">
          <span class="fin-est-num">{{ fmt(num(resumo()?.previsto)) }}</span>
          <span class="fin-est-lbl"><mat-icon>event_available</mat-icon> Previsto</span>
        </div>
        <div class="fin-est">
          <span class="fin-est-num">{{ fmt(num(resumo()?.descontos)) }}</span>
          <span class="fin-est-lbl"><mat-icon>percent</mat-icon> Descontos</span>
        </div>
        <div class="fin-est">
          <span class="fin-est-num">{{ resumo()?.qtd_contas_fechadas ?? 0 }}</span>
          <span class="fin-est-lbl"><mat-icon>receipt_long</mat-icon> Contas fechadas</span>
        </div>
        <div class="fin-est">
          <span class="fin-est-num">{{ fmt(ticketMedio()) }}</span>
          <span class="fin-est-lbl"><mat-icon>point_of_sale</mat-icon> Ticket médio</span>
        </div>
        <span class="fin-resumo-info">
          <mat-icon>info</mat-icon> Todos os valores referem-se ao período acima
        </span>
      </div>

      <!-- ================= Grade de gráficos ================= -->
      <div class="fin-grid">
        <section class="fin-card span2" id="tour-fluxo">
          <header class="fin-card-head">
            <div>
              <h3>Receita no período</h3>
              <small>Caixa recebido por dia × reservas faturadas</small>
            </div>
            <strong class="fin-card-total">{{ fmt(totalRecebido()) }}</strong>
          </header>
          @if (carregando()) {
            <div class="skel sk-chart"></div>
          } @else if (serieRecebido().length) {
            <app-echart [option]="optFluxo()" rotulo="Receita recebida por dia" />
          } @else {
            <p class="fin-vazio"><mat-icon>show_chart</mat-icon> Sem movimentação no período.</p>
          }
        </section>

        <section class="fin-card">
          <header class="fin-card-head">
            <div>
              <h3>Composição da receita</h3>
              <small>De onde veio o valor recebido</small>
            </div>
          </header>
          @if (carregando()) {
            <div class="skel sk-chart"></div>
          } @else if (temComposicao()) {
            <app-echart [option]="optComposicao()" rotulo="Composição da receita" />
          } @else {
            <p class="fin-vazio"><mat-icon>pie_chart</mat-icon> Nada recebido no período.</p>
          }
        </section>

        <section class="fin-card">
          <header class="fin-card-head">
            <div>
              <h3>Formas de pagamento</h3>
              <small>Participação de cada meio no recebido</small>
            </div>
          </header>
          @if (carregando()) {
            <div class="skel sk-chart"></div>
          } @else if (seriePagamento().length) {
            <app-echart [option]="optPagamento()" rotulo="Recebido por forma de pagamento" />
          } @else {
            <p class="fin-vazio"><mat-icon>credit_card</mat-icon> Sem pagamentos no período.</p>
          }
        </section>

        <section class="fin-card">
          <header class="fin-card-head">
            <div>
              <h3>Receita por acomodação</h3>
              <small>Ranking de faturamento de reservas</small>
            </div>
          </header>
          @if (carregando()) {
            <div class="skel sk-chart"></div>
          } @else if (serieAcomodacao().length) {
            <app-echart [option]="optAcomodacao()" rotulo="Receita por acomodação" />
          } @else {
            <p class="fin-vazio"><mat-icon>hotel</mat-icon> Sem reservas faturadas.</p>
          }
        </section>

        <section class="fin-card">
          <header class="fin-card-head">
            <div>
              <h3>Vendas por dia</h3>
              <small>Itens e consumo vendidos</small>
            </div>
            <strong class="fin-card-total">{{ fmt(totalVendas()) }}</strong>
          </header>
          @if (carregando()) {
            <div class="skel sk-chart"></div>
          } @else if (serieVendas().length) {
            <app-echart [option]="optVendas()" rotulo="Vendas por dia" />
          } @else {
            <p class="fin-vazio"><mat-icon>shopping_bag</mat-icon> Sem vendas no período.</p>
          }
        </section>

        <section class="fin-card">
          <header class="fin-card-head">
            <div>
              <h3>Itens mais vendidos</h3>
              <small>Por quantidade — {{ totalItens() }} unid. no período</small>
            </div>
          </header>
          @if (carregando()) {
            <div class="skel sk-chart"></div>
          } @else if (itensVendidos().length) {
            <app-echart [option]="optItens()" rotulo="Itens mais vendidos" />
          } @else {
            <p class="fin-vazio"><mat-icon>inventory_2</mat-icon> Nenhum item vendido.</p>
          }
        </section>
      </div>

      <!-- ================= Tabelas ================= -->
      <div class="inner-card fin-tabelas" id="tour-tabelas">
        <mat-tab-group animationDuration="200ms" mat-stretch-tabs="false">
          <mat-tab label="Reservas do período">
            <div class="fin-tabela-wrap">
              <table class="fin-tabela">
                <thead>
                  <tr>
                    <th>Reserva</th>
                    <th>Hóspede</th>
                    <th>Acomodação</th>
                    <th>Período</th>
                    <th class="tc">Status</th>
                    <th class="tr">Valor final</th>
                    <th class="tc">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  @for (r of reservas(); track r.id) {
                    <tr>
                      <td class="td-id">Nº {{ r.id }}</td>
                      <td>
                        <div class="fin-cell">
                          <span class="fin-avatar">{{ iniciais(r.cliente_nome) }}</span>
                          <span class="fin-cell-nome">{{ r.cliente_nome }}</span>
                        </div>
                      </td>
                      <td>{{ r.acomodacao_nome }}</td>
                      <td class="td-per">
                        {{ r.entradaprevista | date: 'dd/MM/yy' }}
                        <mat-icon>arrow_forward</mat-icon>
                        {{ r.saidaprevista | date: 'dd/MM/yy' }}
                      </td>
                      <td class="tc">
                        <span
                          class="status-chip"
                          [style.background]="statusCor(r.status)"
                          [style.color]="statusTexto(r.status)"
                          >{{ statusRotulo(r.status) }}</span
                        >
                      </td>
                      <td class="tr td-valor">{{ fmt(num(r.valor_estadia)) }}</td>
                      <td class="tc">
                        <a
                          class="badge-acao bg-blue1"
                          [routerLink]="['/reservas', r.id]"
                          title="Abrir reserva"
                        >
                          <mat-icon>visibility</mat-icon>
                        </a>
                      </td>
                    </tr>
                  } @empty {
                    <tr>
                      <td colspan="7" class="fin-vazio-tab">Nenhuma reserva no período.</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </mat-tab>

          <mat-tab label="Vendas do período">
            <div class="fin-tabela-wrap">
              <table class="fin-tabela">
                <thead>
                  <tr>
                    <th>Reserva</th>
                    <th>Produto</th>
                    <th class="tc">Qtd.</th>
                    <th class="tr">Valor</th>
                    <th>Data</th>
                    <th class="tc">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  @for (v of vendasItens(); track $index) {
                    <tr>
                      <td class="td-id">Nº {{ v.idreserva }}</td>
                      <td>{{ v.item }}</td>
                      <td class="tc">{{ v.quantidade }}</td>
                      <td class="tr td-valor">{{ fmt(num(v.valor_total)) }}</td>
                      <td>{{ v.criado_em | date: 'dd/MM/yy HH:mm' }}</td>
                      <td class="tc">
                        <a
                          class="badge-acao bg-blue1"
                          [routerLink]="['/reservas', v.idreserva]"
                          title="Abrir reserva"
                        >
                          <mat-icon>visibility</mat-icon>
                        </a>
                      </td>
                    </tr>
                  } @empty {
                    <tr>
                      <td colspan="6" class="fin-vazio-tab">Nenhuma venda no período.</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </mat-tab>
        </mat-tab-group>
      </div>
    </div>
  `,
  styles: `
    /* ---------- cabeçalho ---------- */
    .fin-head {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: 16px;
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
    .fin-periodo {
      margin: 2px 0 0;
      font-size: 0.82rem;
      color: #7d97a1;
    }
    .fin-head-acoes {
      display: flex;
      gap: 8px;
    }
    .btn-tour {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: 1.5px solid #d7e0e6;
      background: #fff;
      color: #5d6d7e;
      border-radius: 4px;
      padding: 0 14px;
      min-height: 34px;
      cursor: pointer;
      font-size: 0.85rem;
      font-weight: 600;
      font-family: inherit;
      transition:
        border-color 0.15s ease,
        color 0.15s ease;
    }
    .btn-tour mat-icon {
      font-size: 17px;
      width: 17px;
      height: 17px;
    }
    .btn-tour:hover {
      border-color: #1a6f8a;
      color: #1a6f8a;
    }

    /* ---------- período ---------- */
    .fin-periodo-card {
      display: flex;
      align-items: center;
      gap: 14px;
      flex-wrap: wrap;
      padding: 14px 18px;
      margin-bottom: 14px;
    }
    .fin-presets {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    .pre-btn {
      border: 1px solid #d7e0e6;
      background: #fff;
      color: #40525d;
      border-radius: 999px;
      padding: 7px 16px;
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
      transition: all 0.14s ease;
    }
    .pre-btn:hover {
      border-color: #1a6f8a;
      color: #1a6f8a;
    }
    .pre-btn.ativo {
      background: #1a6f8a;
      border-color: #1a6f8a;
      color: #fff;
    }
    .fin-range {
      width: 270px;
      margin-left: auto;
    }

    /* ---------- barra de números ---------- */
    .fin-resumo {
      display: flex;
      align-items: center;
      background: #fff;
      border: 1px solid #e3eaef;
      border-radius: 10px;
      margin-bottom: 16px;
      overflow-x: auto;
    }
    .fin-est {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 3px;
      padding: 14px 26px;
      min-width: 160px;
      border-left: 1px solid #eef2f5;
    }
    .fin-est:first-child {
      border-left: none;
    }
    .fin-est-num {
      font-size: 1.45rem;
      font-weight: 800;
      color: #054054;
      line-height: 1;
      letter-spacing: -0.02em;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .fin-est-lbl {
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
    .fin-est-lbl mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
      color: #a5b6bf;
    }
    .fin-est-online {
      font-size: 0.68rem;
      font-weight: 700;
      color: #1e7d32;
      white-space: nowrap;
    }
    .fin-resumo-info {
      margin-left: auto;
      padding: 0 20px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 0.72rem;
      color: #a5b6bf;
      white-space: nowrap;
    }
    .fin-resumo-info mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }
    @media (max-width: 900px) {
      .fin-resumo-info {
        display: none;
      }
    }

    /* ---------- grade de gráficos ---------- */
    .fin-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
      margin-bottom: 16px;
    }
    .fin-card.span2 {
      grid-column: span 2;
    }
    @media (max-width: 900px) {
      .fin-grid {
        grid-template-columns: 1fr;
      }
      .fin-card.span2 {
        grid-column: span 1;
      }
    }
    .fin-card {
      background: #fff;
      border: 1px solid #e3eaef;
      border-radius: 10px;
      padding: 16px 18px 10px;
      min-width: 0;
      display: flex;
      flex-direction: column;
    }
    .fin-card-head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 6px;
    }
    .fin-card-head h3 {
      margin: 0;
      font-size: 0.95rem;
      font-weight: 700;
      color: #054054;
    }
    .fin-card-head small {
      font-size: 0.74rem;
      color: #8a99a4;
    }
    .fin-card-total {
      font-size: 1.05rem;
      font-weight: 800;
      color: #1a6f8a;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .fin-card app-echart {
      flex: 1;
      min-height: 260px;
    }
    .fin-card.span2 app-echart {
      min-height: 300px;
    }
    .sk-chart {
      height: 260px;
      border-radius: 8px;
      margin: 8px 0;
    }
    .fin-vazio {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      min-height: 200px;
      margin: 0;
      color: #8a99a4;
      font-size: 0.85rem;
    }
    .fin-vazio mat-icon {
      font-size: 20px;
      width: 20px;
      height: 20px;
    }

    /* ---------- tabelas ---------- */
    .fin-tabelas {
      padding: 6px 18px 18px;
    }
    .fin-tabela-wrap {
      overflow-x: auto;
    }
    .fin-tabela {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.92rem;
    }
    .fin-tabela thead th {
      background: #f4f8fa;
      color: #40525d;
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 12px 16px;
      text-align: left;
      border-bottom: 2px solid #e3eaef;
      white-space: nowrap;
    }
    .fin-tabela tbody td {
      padding: 12px 16px;
      border-bottom: 1px solid #eef2f5;
      vertical-align: middle;
      color: #33424c;
    }
    .fin-tabela tbody tr:hover {
      background: #f7fafb;
    }
    .fin-tabela .tc {
      text-align: center;
    }
    .fin-tabela .tr {
      text-align: right;
    }
    .td-id {
      font-weight: 700;
      color: #054054;
      white-space: nowrap;
    }
    .td-valor {
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .td-per {
      white-space: nowrap;
    }
    .td-per mat-icon {
      font-size: 13px;
      width: 13px;
      height: 13px;
      vertical-align: -2px;
      color: #a5b6bf;
    }
    .fin-cell {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }
    .fin-avatar {
      width: 34px;
      height: 34px;
      border-radius: 50%;
      flex-shrink: 0;
      background: linear-gradient(135deg, #1a6f8a, #4b95ab);
      color: #fff;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.02em;
    }
    .fin-cell-nome {
      font-weight: 600;
      color: #054054;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 220px;
    }
    .fin-vazio-tab {
      text-align: center;
      color: #8a99a4;
      padding: 30px !important;
      font-size: 0.85rem;
    }
    .badge-acao {
      display: inline-flex;
      align-items: center;
      border: none;
      border-radius: 0.25rem;
      padding: 0.35em 0.55em;
      color: #fff;
      cursor: pointer;
    }
    .badge-acao mat-icon {
      font-size: 15px;
      width: 15px;
      height: 15px;
    }
    .badge-acao:hover {
      filter: brightness(0.9);
    }
  `,
})
export class FinanceiroComponent extends FinanceiroStore {}
