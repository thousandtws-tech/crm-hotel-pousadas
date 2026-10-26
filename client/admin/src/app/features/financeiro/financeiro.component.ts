import { Component, inject, input, signal, OnInit, effect } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DecimalPipe, DatePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ApiService, STATUS_RESERVA, num } from '@core/services/api.service';
import {
  ItemMaisVendido,
  PontoSerie,
  ReservaResumo,
  ResumoFinanceiro,
  VendaItem,
} from '@core/models/api.models';
import { Notify } from '@core/services/notify.service';
import { Realtime } from '@core/services/realtime.service';
import { DateInputComponent } from '@shared/components/date-input.component';

// Barras CSS puras — sem dependência de chart lib.
@Component({
  selector: 'app-serie',
  imports: [DecimalPipe],
  template: `
    @if (pontos().length) {
      <div class="chart">
        @for (p of pontos(); track p.rotulo) {
          <div class="bar-wrap" [title]="p.rotulo + ': R$ ' + (num(p.valor) | number: '1.2-2')">
            <div
              class="bar"
              [style.height.%]="altura(p)"
            ></div>
            <span class="lbl">{{ p.rotulo }}</span>
          </div>
        }
      </div>
    } @else {
      <p class="muted" style="padding: 24px">Sem dados no período.</p>
    }
  `,
  styles: `
    .chart {
      display: flex; align-items: flex-end; gap: 4px;
      height: 220px; padding: 16px; overflow-x: auto;
    }
    .bar-wrap {
      display: flex; flex-direction: column; align-items: center;
      justify-content: flex-end; min-width: 36px; height: 100%;
    }
    .bar {
      width: 100%; min-height: 2px;
      background: #274259;
      border-radius: 4px 4px 0 0;
    }
    .lbl { font-size: 11px; color: #64748b; }
  `,
})
export class SerieComponent {
  readonly pontos = input.required<PontoSerie[]>();
  protected readonly num = num;

  protected altura(p: PontoSerie): number {
    const max = Math.max(...this.pontos().map((x) => num(x.valor)), 1);
    return Math.max((num(p.valor) / max) * 100, 2);
  }
}

// Barras horizontais — ranking por nome (itens vendidos, acomodações).
export interface RankingRow {
  rotulo: string;
  valor: number;
  info: string;
}

@Component({
  selector: 'app-ranking',
  imports: [],
  template: `
    @if (linhas().length) {
      <div class="ranking">
        @for (r of linhas(); track r.rotulo) {
          <div class="row">
            <span class="rot" [title]="r.rotulo">{{ r.rotulo }}</span>
            <div class="track">
              <div class="fill" [style.width.%]="largura(r)"></div>
            </div>
            <span class="info">{{ r.info }}</span>
          </div>
        }
      </div>
    } @else {
      <p class="muted" style="padding: 24px">Sem dados no período.</p>
    }
  `,
  styles: `
    .ranking { display: flex; flex-direction: column; gap: 10px; padding: 16px; }
    .row { display: flex; align-items: center; gap: 10px; }
    .rot {
      width: 160px; flex-shrink: 0; font-size: 0.85rem;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .track { flex: 1; height: 14px; background: #eee; border-radius: 3px; overflow: hidden; }
    .fill { height: 100%; background: #274259; border-radius: 3px; }
    .info { width: 130px; flex-shrink: 0; text-align: right; font-size: 0.85rem; font-weight: 600; }
  `,
})
export class RankingComponent {
  readonly linhas = input.required<RankingRow[]>();

  protected largura(r: RankingRow): number {
    const max = Math.max(...this.linhas().map((x) => x.valor), 1);
    return Math.max((r.valor / max) * 100, 2);
  }
}

type Secao = 'reservas' | 'vendas';

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

@Component({
  selector: 'app-financeiro',
  imports: [
    RouterLink,
    DecimalPipe,
    DatePipe,
    MatIconModule,
    MatProgressSpinnerModule,
    SerieComponent,
    RankingComponent,
    DateInputComponent,
  ],
  template: `
    <div class="page">
      <!-- ===== cards mês/ano (cards.php do legado) ===== -->
      <div class="grid-cards">
        <div class="card-dash bg-success text-white" style="height: 6.5rem">
          <div class="line-card">
            <div class="ic">
              <mat-icon>savings</mat-icon>
              <small class="desc-card">Recebido</small>
            </div>
            <div class="val">
              <span>{{ mesAtual }}</span>
              <p class="value-card">
                <mat-icon class="coin">paid</mat-icon>
                R$ {{ num(resumoMes()?.recebido) | number: '1.2-2' }}
              </p>
            </div>
          </div>
        </div>
        <div class="card-dash bg-blue text-white" style="height: 6.5rem">
          <div class="line-card">
            <div class="ic">
              <mat-icon>point_of_sale</mat-icon>
              <small class="desc-card">Previsto</small>
            </div>
            <div class="val">
              <span>{{ mesAtual }}</span>
              <p class="value-card">
                + R$ {{ num(resumoMes()?.previsto) | number: '1.2-2' }}
              </p>
            </div>
          </div>
        </div>
        <div class="card-dash bg-success text-white" style="height: 6.5rem">
          <div class="line-card">
            <div class="ic">
              <mat-icon>account_balance</mat-icon>
              <small class="desc-card">Recebido</small>
            </div>
            <div class="val">
              <span>Ano de {{ anoAtual }}</span>
              <p class="value-card">
                <mat-icon class="coin">paid</mat-icon>
                R$ {{ num(resumoAno()?.recebido) | number: '1.2-2' }}
              </p>
            </div>
          </div>
        </div>
        <div class="card-dash bg-blue text-white" style="height: 6.5rem">
          <div class="line-card">
            <div class="ic">
              <mat-icon>monetization_on</mat-icon>
              <small class="desc-card">Previsto</small>
            </div>
            <div class="val">
              <span>Ano de {{ anoAtual }}</span>
              <p class="value-card">
                + R$ {{ num(resumoAno()?.previsto) | number: '1.2-2' }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- ===== toggle Reservas | Vendas ===== -->
      <div class="btn-group-inn">
        <button
          class="btn-dark-blue"
          type="button"
          [disabled]="secao() === 'reservas'"
          (click)="secao.set('reservas')"
        >Reservas</button>
        <button
          class="btn-dark-blue"
          type="button"
          [disabled]="secao() === 'vendas'"
          (click)="secao.set('vendas')"
        >Vendas</button>
      </div>

      @if (secao() === 'reservas') {
        <!-- ================= RESERVAS ================= -->
        <div class="range">
          <app-date class="date" [value]="iniRes()" (alterar)="iniRes.set($event)" />
          <span class="ate">até</span>
          <app-date class="date" [value]="fimRes()" (alterar)="fimRes.set($event)" />
          <button class="btn-dark-blue" type="button" (click)="carregarReservas()">
            <mat-icon>search</mat-icon> Buscar
          </button>
        </div>

        <div class="inner-card">
          <div class="inner-card-header"><h4>Lucro de reservas por acomodações</h4></div>
          <div class="inner-card-body">
            <small>
              Total: <b>R$ {{ totalSerie(serieAcomodacao()) | number: '1.2-2' }}</b>
            </small>
            <app-ranking [linhas]="rankingAcomodacoes()" />
          </div>
        </div>

        <div class="inner-card">
          <div class="inner-card-header"><h4>Reservas</h4></div>
          <div class="inner-card-body">
            <div class="tbl-wrap">
              <table class="plain">
                <thead>
                  <tr>
                    <th>Reserva</th>
                    <th>Acomodação</th>
                    <th>Cliente</th>
                    <th>Período</th>
                    <th>Situação</th>
                    <th>Valor final</th>
                    <th class="tc">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  @for (r of reservas(); track r.id) {
                    <tr>
                      <td>{{ r.id }}</td>
                      <td>{{ r.acomodacao_nome }}</td>
                      <td>{{ r.cliente_nome }}</td>
                      <td>
                        {{ r.entradaprevista | date: 'dd/MM/yy' }} →
                        {{ r.saidaprevista | date: 'dd/MM/yy' }}
                      </td>
                      <td>
                        <span
                          class="status-chip"
                          [style.background]="statusCor(r.status)"
                          [style.color]="statusTexto(r.status)"
                        >{{ statusRotulo(r.status) }}</span>
                      </td>
                      <td>R$ {{ num(r.valor_estadia) | number: '1.2-2' }}</td>
                      <td class="tc">
                        <a class="badge-acao bg-blue1" [routerLink]="['/reservas', r.id]" title="Visualizar">
                          <mat-icon>visibility</mat-icon>
                        </a>
                      </td>
                    </tr>
                  } @empty {
                    <tr><td colspan="7" class="muted tc">Nenhuma reserva no período.</td></tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        </div>
      } @else {
        <!-- ================= VENDAS ================= -->
        <div class="range">
          <app-date class="date" [value]="iniVen()" (alterar)="iniVen.set($event)" />
          <span class="ate">até</span>
          <app-date class="date" [value]="fimVen()" (alterar)="fimVen.set($event)" />
          <button class="btn-dark-blue" type="button" (click)="carregarVendas()">
            <mat-icon>search</mat-icon> Buscar
          </button>
        </div>

        <div class="inner-card">
          <div class="inner-card-header"><h4>Itens mais vendidos</h4></div>
          <div class="inner-card-body">
            <small>
              <b>{{ totalItensVendidos() }} itens vendidos</b>
            </small>
            <app-ranking [linhas]="rankingItens()" />
          </div>
        </div>

        <div class="inner-card">
          <div class="inner-card-header"><h4>Lucro de vendas</h4></div>
          <div class="inner-card-body">
            <small>
              Total: <b>R$ {{ totalSerie(serieVendas()) | number: '1.2-2' }}</b>
            </small>
            <app-serie [pontos]="serieVendas()" />
          </div>
        </div>

        <div class="grid-2">
          <div class="inner-card">
            <div class="inner-card-header"><h4>Recebido por dia</h4></div>
            <div class="inner-card-body">
              <small>
                Total: <b>R$ {{ totalSerie(serieRecebido()) | number: '1.2-2' }}</b>
              </small>
              <app-serie [pontos]="serieRecebido()" />
            </div>
          </div>
          <div class="inner-card">
            <div class="inner-card-header"><h4>Por forma de pagamento</h4></div>
            <div class="inner-card-body">
              <app-serie [pontos]="seriePagamento()" />
            </div>
          </div>
        </div>

        <div class="inner-card">
          <div class="inner-card-header"><h4>Vendas</h4></div>
          <div class="inner-card-body">
            <div class="tbl-wrap">
              <table class="plain">
                <thead>
                  <tr>
                    <th>Reserva</th>
                    <th>Produto</th>
                    <th>Quantidade</th>
                    <th>Valor final</th>
                    <th>Data</th>
                    <th class="tc">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  @for (v of vendasItens(); track $index) {
                    <tr>
                      <td>Nº {{ v.idreserva }}</td>
                      <td>{{ v.item }}</td>
                      <td>{{ v.quantidade }}</td>
                      <td>R$ {{ num(v.valor_total) | number: '1.2-2' }}</td>
                      <td>{{ v.criado_em | date: 'dd/MM/yy' }}</td>
                      <td class="tc">
                        <a class="badge-acao bg-blue1" [routerLink]="['/reservas', v.idreserva]" title="Visualizar">
                          <mat-icon>visibility</mat-icon>
                        </a>
                      </td>
                    </tr>
                  } @empty {
                    <tr><td colspan="6" class="muted tc">Nenhuma venda realizada no período.</td></tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: `
    .grid-cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 1rem;
      margin-bottom: 1rem;
      margin-top: 0.5rem;
    }
    .ic { display: flex; flex-direction: column; gap: 2px; }
    .ic mat-icon { font-size: 2.4rem; width: 2.4rem; height: 2.4rem; }
    .desc-card { font-size: 75%; font-weight: 700; }
    .val { text-align: right; }
    .value-card {
      font-size: 1rem; font-weight: 700; margin: 4px 0 0;
      display: flex; align-items: center; gap: 4px; justify-content: flex-end;
    }
    .coin { font-size: 16px; width: 16px; height: 16px; }

    .btn-group-inn { margin-bottom: 1rem; }

    .range {
      display: flex; align-items: center; gap: 6px;
      margin: 0.5rem 0 1rem; flex-wrap: wrap;
    }
    .range .date { width: 160px; }
    .ate { font-size: 0.85rem; color: #555; }

    .tbl-wrap { overflow-x: auto; }
    .badge-acao {
      display: inline-flex; align-items: center;
      border: none; border-radius: 0.25rem;
      padding: 0.35em 0.55em; color: #fff; cursor: pointer;
    }
    .badge-acao mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .badge-acao:hover { filter: brightness(0.9); }
    .grid-2 {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 1rem;
    }
    .inner-card h4 { font-weight: 600; }
  `,
})
export class FinanceiroComponent implements OnInit {
  private readonly rt = inject(Realtime);

  constructor() {
    let ultimo = -1;
    effect(() => {
      const v = this.rt.mudanca('reserva', 'consumo', 'item_consumido', 'adicional_consumo');
      if (ultimo < 0) {
        ultimo = v;
        return;
      }
      if (v !== ultimo) {
        ultimo = v;
        this.api
          .resumoFinanceiro(this.iniRes(), this.fimRes())
          .subscribe({ next: (r) => this.resumoMes.set(r), error: () => undefined });
        this.carregarReservas();
        this.carregarVendas();
      }
    });
  }
  private readonly api = inject(ApiService);
  private readonly notify = inject(Notify);

  protected readonly num = num;
  protected readonly hoje = new Date();
  protected readonly mesAtual = MESES[this.hoje.getMonth()];
  protected readonly anoAtual = this.hoje.getFullYear();

  protected readonly secao = signal<Secao>('reservas');

  protected readonly resumoMes = signal<ResumoFinanceiro | null>(null);
  protected readonly resumoAno = signal<ResumoFinanceiro | null>(null);

  protected readonly iniRes = signal(iso(new Date(this.hoje.getFullYear(), this.hoje.getMonth(), 1)));
  protected readonly fimRes = signal(iso(new Date(this.hoje.getFullYear(), this.hoje.getMonth() + 1, 0)));
  protected readonly iniVen = signal(this.iniRes());
  protected readonly fimVen = signal(this.fimRes());

  protected readonly reservas = signal<ReservaResumo[]>([]);
  protected readonly vendasItens = signal<VendaItem[]>([]);
  protected readonly itensVendidos = signal<ItemMaisVendido[]>([]);
  protected readonly serieAcomodacao = signal<PontoSerie[]>([]);
  protected readonly serieVendas = signal<PontoSerie[]>([]);
  protected readonly serieRecebido = signal<PontoSerie[]>([]);
  protected readonly seriePagamento = signal<PontoSerie[]>([]);

  ngOnInit(): void {
    // cards do topo — mês corrente e ano corrente
    this.api
      .resumoFinanceiro(this.iniRes(), this.fimRes())
      .subscribe({ next: (r) => this.resumoMes.set(r), error: (e) => this.notify.erro(e) });
    this.api
      .resumoFinanceiro(`${this.anoAtual}-01-01`, `${this.anoAtual}-12-31`)
      .subscribe({ next: (r) => this.resumoAno.set(r), error: () => undefined });

    this.carregarReservas();
    this.carregarVendas();
  }

  carregarReservas(): void {
    const i = this.iniRes();
    const f = this.fimRes();
    this.api
      .listarReservas({ inicio: i, fim: f, page: 1, porPagina: 200 })
      .subscribe({ next: (p) => this.reservas.set(p.items), error: (e) => this.notify.erro(e) });
    this.api.seriePorAcomodacao(i, f).subscribe({
      next: (s) => this.serieAcomodacao.set(s),
      error: () => undefined,
    });
  }

  carregarVendas(): void {
    const i = this.iniVen();
    const f = this.fimVen();
    this.api.vendasFinanceiro(i, f).subscribe({
      next: (v) => this.vendasItens.set(v),
      error: (e) => this.notify.erro(e),
    });
    this.api.itensMaisVendidos(i, f).subscribe({
      next: (v) => this.itensVendidos.set(v),
      error: () => undefined,
    });
    this.api.serieVendas(i, f).subscribe({
      next: (s) => this.serieVendas.set(s),
      error: () => undefined,
    });
    this.api.serieRecebido(i, f).subscribe({
      next: (s) => this.serieRecebido.set(s),
      error: () => undefined,
    });
    this.api.seriePorPagamento(i, f).subscribe({
      next: (s) => this.seriePagamento.set(s),
      error: () => undefined,
    });
  }

  protected rankingAcomodacoes(): RankingRow[] {
    return this.serieAcomodacao().map((p) => ({
      rotulo: p.rotulo,
      valor: num(p.valor),
      info: `R$ ${num(p.valor).toFixed(2)}`,
    }));
  }

  protected rankingItens(): RankingRow[] {
    return this.itensVendidos().map((i) => ({
      rotulo: i.nome,
      valor: i.quantidade,
      info: `${i.quantidade} unid.`,
    }));
  }

  protected totalItensVendidos(): number {
    return this.itensVendidos().reduce((s, i) => s + i.quantidade, 0);
  }

  totalSerie(pontos: PontoSerie[]): number {
    return pontos.reduce((s, p) => s + num(p.valor), 0);
  }

  statusRotulo(s: string): string {
    return STATUS_RESERVA[s as keyof typeof STATUS_RESERVA]?.rotulo ?? s;
  }
  statusCor(s: string): string {
    return STATUS_RESERVA[s as keyof typeof STATUS_RESERVA]?.cor ?? '#6c757d';
  }
  statusTexto(s: string): string {
    return STATUS_RESERVA[s as keyof typeof STATUS_RESERVA]?.texto ?? '#fff';
  }
}
