import {
  Component,
  computed,
  inject,
  signal,
  OnInit,
  effect,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { provideNativeDateAdapter } from '@angular/material/core';
import { MatTabsModule } from '@angular/material/tabs';
import { debounceTime } from 'rxjs';
import { RelatoriosApi } from '@core/api/relatorios.api';
import { ReservasApi } from '@core/api/reservas.api';
import { STATUS_RESERVA } from '@core/models/reservas.models';
import { num } from '@core/utils/num';
import { ItemMaisVendido, PontoSerie, ResumoFinanceiro, VendaItem } from '@core/models/relatorios.models';
import { ReservaResumo } from '@core/models/reservas.models';
import { Notify } from '@core/services/notify.service';
import { Realtime } from '@core/services/realtime.service';
import { TourGuiado } from '@core/services/tour.service';
import { EChartComponent, EChartOption } from '@shared/components/echart.component';
import { FinNavComponent } from './fin-nav.component';

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
          <button class="btn-tour" type="button" (click)="iniciarTour()" aria-label="Ver tutorial da tela">
            <mat-icon>school</mat-icon> Tutorial
          </button>
        </div>
      </div>

      <!-- ================= Período ================= -->
      <div class="inner-card fin-periodo-card">
        <div class="fin-presets" role="group" aria-label="Períodos rápidos">
          <button type="button" class="pre-btn" [class.ativo]="preset() === 'mes'" (click)="aplicarPreset('mes')">Este mês</button>
          <button type="button" class="pre-btn" [class.ativo]="preset() === 'mesAnt'" (click)="aplicarPreset('mesAnt')">Mês passado</button>
          <button type="button" class="pre-btn" [class.ativo]="preset() === 'd30'" (click)="aplicarPreset('d30')">Últimos 30 dias</button>
          <button type="button" class="pre-btn" [class.ativo]="preset() === 'ano'" (click)="aplicarPreset('ano')">Este ano</button>
        </div>
        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="campo-mat fin-range">
          <mat-date-range-input [rangePicker]="picker" [formGroup]="range">
            <input matStartDate formControlName="inicio" placeholder="De" aria-label="Data inicial" />
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
                        >{{ statusRotulo(r.status) }}</span>
                      </td>
                      <td class="tr td-valor">{{ fmt(num(r.valor_estadia)) }}</td>
                      <td class="tc">
                        <a class="badge-acao bg-blue1" [routerLink]="['/reservas', r.id]" title="Abrir reserva">
                          <mat-icon>visibility</mat-icon>
                        </a>
                      </td>
                    </tr>
                  } @empty {
                    <tr><td colspan="7" class="fin-vazio-tab">Nenhuma reserva no período.</td></tr>
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
                        <a class="badge-acao bg-blue1" [routerLink]="['/reservas', v.idreserva]" title="Abrir reserva">
                          <mat-icon>visibility</mat-icon>
                        </a>
                      </td>
                    </tr>
                  } @empty {
                    <tr><td colspan="6" class="fin-vazio-tab">Nenhuma venda no período.</td></tr>
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
      display: flex; justify-content: space-between; align-items: flex-end;
      gap: 16px; flex-wrap: wrap;
      padding-bottom: 14px; margin-bottom: 16px;
      border-bottom: 1px solid #e3eaef;
    }
    .fin-titulo {
      margin: 0; font-size: 1.5rem; font-weight: 800; color: #054054;
      letter-spacing: -0.02em;
    }
    .fin-periodo { margin: 2px 0 0; font-size: 0.82rem; color: #7d97a1; }
    .fin-head-acoes { display: flex; gap: 8px; }
    .btn-tour {
      display: inline-flex; align-items: center; gap: 6px;
      border: 1.5px solid #d7e0e6; background: #fff;
      color: #5d6d7e; border-radius: 4px;
      padding: 0 14px; min-height: 34px; cursor: pointer;
      font-size: 0.85rem; font-weight: 600; font-family: inherit;
      transition: border-color .15s ease, color .15s ease;
    }
    .btn-tour mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .btn-tour:hover { border-color: #1a6f8a; color: #1a6f8a; }

    /* ---------- período ---------- */
    .fin-periodo-card {
      display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
      padding: 14px 18px; margin-bottom: 14px;
    }
    .fin-presets { display: flex; gap: 6px; flex-wrap: wrap; }
    .pre-btn {
      border: 1px solid #d7e0e6; background: #fff; color: #40525d;
      border-radius: 999px; padding: 7px 16px;
      font-size: 0.8rem; font-weight: 600; cursor: pointer; font-family: inherit;
      transition: all .14s ease;
    }
    .pre-btn:hover { border-color: #1a6f8a; color: #1a6f8a; }
    .pre-btn.ativo {
      background: #1a6f8a; border-color: #1a6f8a; color: #fff;
    }
    .fin-range { width: 270px; margin-left: auto; }

    /* ---------- barra de números ---------- */
    .fin-resumo {
      display: flex; align-items: center;
      background: #fff; border: 1px solid #e3eaef; border-radius: 10px;
      margin-bottom: 16px; overflow-x: auto;
    }
    .fin-est {
      display: flex; flex-direction: column; align-items: flex-start; gap: 3px;
      padding: 14px 26px; min-width: 160px;
      border-left: 1px solid #eef2f5;
    }
    .fin-est:first-child { border-left: none; }
    .fin-est-num {
      font-size: 1.45rem; font-weight: 800; color: #054054;
      line-height: 1; letter-spacing: -0.02em;
      font-variant-numeric: tabular-nums; white-space: nowrap;
    }
    .fin-est-lbl {
      display: inline-flex; align-items: center; gap: 5px;
      font-size: 0.68rem; font-weight: 600; color: #7d97a1;
      text-transform: uppercase; letter-spacing: 0.07em; white-space: nowrap;
    }
    .fin-est-lbl mat-icon { font-size: 14px; width: 14px; height: 14px; color: #a5b6bf; }
    .fin-resumo-info {
      margin-left: auto; padding: 0 20px;
      display: inline-flex; align-items: center; gap: 6px;
      font-size: 0.72rem; color: #a5b6bf; white-space: nowrap;
    }
    .fin-resumo-info mat-icon { font-size: 14px; width: 14px; height: 14px; }
    @media (max-width: 900px) { .fin-resumo-info { display: none; } }

    /* ---------- grade de gráficos ---------- */
    .fin-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px; margin-bottom: 16px;
    }
    .fin-card.span2 { grid-column: span 2; }
    @media (max-width: 900px) {
      .fin-grid { grid-template-columns: 1fr; }
      .fin-card.span2 { grid-column: span 1; }
    }
    .fin-card {
      background: #fff; border: 1px solid #e3eaef; border-radius: 10px;
      padding: 16px 18px 10px; min-width: 0;
      display: flex; flex-direction: column;
    }
    .fin-card-head {
      display: flex; justify-content: space-between; align-items: flex-start;
      gap: 12px; margin-bottom: 6px;
    }
    .fin-card-head h3 {
      margin: 0; font-size: 0.95rem; font-weight: 700; color: #054054;
    }
    .fin-card-head small { font-size: 0.74rem; color: #8a99a4; }
    .fin-card-total {
      font-size: 1.05rem; font-weight: 800; color: #1a6f8a;
      font-variant-numeric: tabular-nums; white-space: nowrap;
    }
    .fin-card app-echart { flex: 1; min-height: 260px; }
    .fin-card.span2 app-echart { min-height: 300px; }
    .sk-chart {
      height: 260px; border-radius: 8px; margin: 8px 0;
    }
    .fin-vazio {
      flex: 1; display: flex; align-items: center; justify-content: center;
      gap: 8px; min-height: 200px; margin: 0;
      color: #8a99a4; font-size: 0.85rem;
    }
    .fin-vazio mat-icon { font-size: 20px; width: 20px; height: 20px; }

    /* ---------- tabelas ---------- */
    .fin-tabelas { padding: 6px 18px 18px; }
    .fin-tabela-wrap { overflow-x: auto; }
    .fin-tabela { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
    .fin-tabela thead th {
      background: #f4f8fa; color: #40525d;
      font-size: 0.75rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.05em; padding: 12px 16px; text-align: left;
      border-bottom: 2px solid #e3eaef; white-space: nowrap;
    }
    .fin-tabela tbody td {
      padding: 12px 16px; border-bottom: 1px solid #eef2f5;
      vertical-align: middle; color: #33424c;
    }
    .fin-tabela tbody tr:hover { background: #f7fafb; }
    .fin-tabela .tc { text-align: center; }
    .fin-tabela .tr { text-align: right; }
    .td-id { font-weight: 700; color: #054054; white-space: nowrap; }
    .td-valor { font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .td-per { white-space: nowrap; }
    .td-per mat-icon { font-size: 13px; width: 13px; height: 13px; vertical-align: -2px; color: #a5b6bf; }
    .fin-cell { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .fin-avatar {
      width: 34px; height: 34px; border-radius: 50%; flex-shrink: 0;
      background: linear-gradient(135deg, #1a6f8a, #4b95ab); color: #fff;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 0.72rem; font-weight: 700; letter-spacing: 0.02em;
    }
    .fin-cell-nome {
      font-weight: 600; color: #054054;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 220px;
    }
    .fin-vazio-tab { text-align: center; color: #8a99a4; padding: 30px !important; font-size: 0.85rem; }
    .badge-acao {
      display: inline-flex; align-items: center;
      border: none; border-radius: 0.25rem;
      padding: 0.35em 0.55em; color: #fff; cursor: pointer;
    }
    .badge-acao mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .badge-acao:hover { filter: brightness(0.9); }
  `,
})
export class FinanceiroComponent implements OnInit {
  private readonly relatoriosApi = inject(RelatoriosApi);
  private readonly reservasApi = inject(ReservasApi);
  private readonly notify = inject(Notify);
  private readonly rt = inject(Realtime);
  private readonly tour = inject(TourGuiado);

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
        'reserva', 'consumo', 'item_consumido', 'adicional_consumo', 'pagamento',
      );
      if (ultimo < 0) { ultimo = v; return; }
      if (v !== ultimo) { ultimo = v; this.carregar(); }
    });
    this.range.valueChanges
      .pipe(debounceTime(250))
      .subscribe(({ inicio, fim }) => {
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
    let pendentes = 8;
    const fimReq = () => { if (--pendentes === 0) this.carregando.set(false); };

    this.relatoriosApi.resumoFinanceiro(i, f).subscribe({
      next: (r) => { this.resumo.set(r); fimReq(); },
      error: (e) => { this.notify.erro(e); fimReq(); },
    });
    this.relatoriosApi.serieRecebido(i, f).subscribe({
      next: (s) => { this.serieRecebido.set(s); fimReq(); },
      error: () => fimReq(),
    });
    this.relatoriosApi.serieReservas(i, f).subscribe({
      next: (s) => { this.serieReservasFat.set(s); fimReq(); },
      error: () => fimReq(),
    });
    this.relatoriosApi.serieVendas(i, f).subscribe({
      next: (s) => { this.serieVendas.set(s); fimReq(); },
      error: () => fimReq(),
    });
    this.relatoriosApi.seriePorPagamento(i, f).subscribe({
      next: (s) => { this.seriePagamento.set(s); fimReq(); },
      error: () => fimReq(),
    });
    this.relatoriosApi.seriePorAcomodacao(i, f).subscribe({
      next: (s) => { this.serieAcomodacao.set(s); fimReq(); },
      error: () => fimReq(),
    });
    this.relatoriosApi.itensMaisVendidos(i, f).subscribe({
      next: (v) => { this.itensVendidos.set(v); fimReq(); },
      error: () => fimReq(),
    });
    this.reservasApi.listarReservas({ inicio: i, fim: f, page: 1, porPagina: 200 }).subscribe({
      next: (p) => { this.reservas.set(p.items); fimReq(); },
      error: () => fimReq(),
    });
    this.relatoriosApi.vendasFinanceiro(i, f).subscribe({
      next: (v) => this.vendasItens.set(v),
      error: (e) => this.notify.erro(e),
    });
  }

  // ---------------- derivados ----------------
  protected readonly ticketMedio = computed(() => {
    const r = this.resumo();
    const q = r?.qtd_contas_fechadas ?? 0;
    return q > 0 ? num(r?.recebido) / q : 0;
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
    return num(r?.recebido_estadias) + num(r?.recebido_itens) + num(r?.recebido_adicionais) > 0;
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
            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
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
      color: [C.teal, C.gold, C.light],
      tooltip: { trigger: 'item', valueFormatter: (v: unknown) => BRL.format(Number(v)) },
      legend: {
        bottom: 0,
        icon: 'circle',
        itemWidth: 9,
        itemHeight: 9,
        textStyle: { color: '#5d6d7e', fontSize: 11 },
      },
      series: [{
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
        ],
      }],
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
    series: [{
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
    }],
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
      series: [{
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
      }],
    };
  });

  protected readonly optVendas = computed<EChartOption>(() => ({
    tooltip: TOOLTIP_BRL,
    grid: { left: 8, right: 12, top: 18, bottom: 4, containLabel: true },
    xAxis: { ...axisCategoria(), data: this.serieVendas().map((p) => p.rotulo) },
    yAxis: axisValor(),
    series: [{
      name: 'Vendas',
      type: 'bar',
      barWidth: '55%',
      itemStyle: { color: C.gold, borderRadius: [5, 5, 0, 0] },
      data: this.serieVendas().map((p) => num(p.valor)),
    }],
  }));

  protected readonly optItens = computed<EChartOption>(() => {
    const dados = [...this.itensVendidos()]
      .sort((a, b) => a.quantidade - b.quantidade)
      .slice(-10);
    return {
      tooltip: {
        trigger: 'item',
        formatter: ttItem(
          (p) => `${p.name}<br/><b>${p.value} unid.</b> · ${BRL.format(num(dados[p.dataIndex]?.valor))}`,
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
      series: [{
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
      }],
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
