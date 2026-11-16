import { Component, computed, inject, signal, OnInit, effect } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { RelatoriosApi } from '@core/api/relatorios.api';
import { STATUS_RESERVA } from '@core/models/reservas.models';
import { DashboardResponse, PontoSerie, ResumoFinanceiro } from '@core/models/relatorios.models';
import { Notify } from '@core/services/notify.service';
import { Realtime } from '@core/services/realtime.service';
import { TourGuiado } from '@core/services/tour.service';
import { EChartComponent, EChartOption } from '@shared/components/echart.component';

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
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;

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

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, DatePipe, MatIconModule, EChartComponent],
  template: `
    <div class="page">
      <!-- ================= Cabeçalho ================= -->
      <div class="d-head">
        <div>
          <h2 class="d-titulo">Dashboard</h2>
          <p class="d-sub">{{ hoje | date: "EEEE, d 'de' MMMM 'de' yyyy" }}</p>
        </div>
        <button class="btn-tour" type="button" (click)="iniciarTour()" aria-label="Ver tutorial da tela">
          <mat-icon>school</mat-icon> Tutorial
        </button>
      </div>

      <!-- ================= Slicer de período (estilo Power BI) ================= -->
      <div class="d-slicer" id="tour-slicer">
        <span class="d-slicer-lbl"><mat-icon>filter_alt</mat-icon> Período dos gráficos</span>
        <div class="d-presets" role="group" aria-label="Períodos rápidos">
          <button type="button" class="pre-btn" [class.ativo]="preset() === 'd7'" (click)="aplicar('d7')">7 dias</button>
          <button type="button" class="pre-btn" [class.ativo]="preset() === 'd30'" (click)="aplicar('d30')">30 dias</button>
          <button type="button" class="pre-btn" [class.ativo]="preset() === 'mes'" (click)="aplicar('mes')">Este mês</button>
          <button type="button" class="pre-btn" [class.ativo]="preset() === 'mesAnt'" (click)="aplicar('mesAnt')">Mês passado</button>
        </div>
        <span class="d-slicer-per">
          {{ ini() | date: 'dd/MM/yy' }} — {{ fim() | date: 'dd/MM/yy' }}
        </span>
      </div>

      <!-- ================= Tiles de KPI ================= -->
      @if (carregandoOps()) {
        <div class="kpi-grid">
          @for (s of [1, 2, 3, 4, 5, 6]; track s) {
            <div class="skel kpi-skel"></div>
          }
        </div>
      } @else if (dados(); as d) {
        <div class="kpi-grid" id="tour-kpis">
          <div class="kpi">
            <div class="kpi-top">
              <span class="kpi-lbl">Hóspedes na casa</span>
              <mat-icon class="kpi-ic">group</mat-icon>
            </div>
            <span class="kpi-num">{{ d.cards.hospedes_atuais }}</span>
            <span class="kpi-sub">em {{ d.cards.acomodacoes_ocupadas }} acomodações</span>
          </div>

          <div class="kpi">
            <div class="kpi-top">
              <span class="kpi-lbl">Ocupação</span>
              <mat-icon class="kpi-ic">hotel</mat-icon>
            </div>
            <span class="kpi-num">{{ ocupacao() }}%</span>
            <div class="kpi-bar" role="img" [attr.aria-label]="'Ocupação de ' + ocupacao() + '%'">
              <i [style.width.%]="ocupacao()"></i>
            </div>
            <span class="kpi-sub">
              {{ d.cards.acomodacoes_ocupadas }} de {{ d.cards.total_acomodacoes }} acomodações
            </span>
          </div>

          <div class="kpi">
            <div class="kpi-top">
              <span class="kpi-lbl">Chegadas hoje</span>
              <mat-icon class="kpi-ic">login</mat-icon>
            </div>
            <span class="kpi-num" [class.kpi-alerta]="d.cards.checkins_pendentes_hoje > 0">
              {{ d.cards.checkins_pendentes_hoje }}
            </span>
            <span class="kpi-sub">pendentes · {{ d.cards.checkins_hoje }} já realizados</span>
          </div>

          <div class="kpi">
            <div class="kpi-top">
              <span class="kpi-lbl">Saídas hoje</span>
              <mat-icon class="kpi-ic">logout</mat-icon>
            </div>
            <span class="kpi-num" [class.kpi-alerta]="d.cards.checkouts_pendentes_hoje > 0">
              {{ d.cards.checkouts_pendentes_hoje }}
            </span>
            <span class="kpi-sub">pendentes · {{ d.cards.checkouts_hoje }} já realizadas</span>
          </div>

          <div class="kpi">
            <div class="kpi-top">
              <span class="kpi-lbl">Recebido</span>
              <mat-icon class="kpi-ic">payments</mat-icon>
            </div>
            <span class="kpi-num kpi-din">{{ fmt(num(resumo()?.recebido)) }}</span>
            <span class="kpi-sub">no período selecionado</span>
          </div>

          <div class="kpi">
            <div class="kpi-top">
              <span class="kpi-lbl">Previsto</span>
              <mat-icon class="kpi-ic">event_available</mat-icon>
            </div>
            <span class="kpi-num kpi-din kpi-prev">{{ fmt(num(resumo()?.previsto)) }}</span>
            <span class="kpi-sub">a receber no período</span>
          </div>
        </div>
      }

      <!-- ================= Linha de gráficos 1 ================= -->
      <div class="d-grid d-grid-a">
        <section class="d-card" id="tour-receita">
          <header class="d-card-head">
            <div>
              <h3>Receita recebida</h3>
              <small>Dinheiro que entrou no caixa por dia</small>
            </div>
            <strong class="d-card-total">{{ fmt(totalRecebido()) }}</strong>
          </header>
          @if (carregandoFin()) {
            <div class="skel sk-chart"></div>
          } @else if (serieRecebido().length) {
            <app-echart [option]="optFluxo()" rotulo="Receita recebida por dia" />
          } @else {
            <p class="d-vazio"><mat-icon>show_chart</mat-icon> Sem movimentação no período.</p>
          }
        </section>

        <section class="d-card" id="tour-ocupacao">
          <header class="d-card-head">
            <div>
              <h3>Taxa de ocupação</h3>
              <small>Quartos ocupados agora</small>
            </div>
          </header>
          @if (carregandoOps()) {
            <div class="skel sk-chart"></div>
          } @else {
            <app-echart [option]="optOcupacao()" rotulo="Taxa de ocupação" />
          }
        </section>
      </div>

      <!-- ================= Linha de gráficos 2 ================= -->
      <div class="d-grid d-grid-b">
        <section class="d-card">
          <header class="d-card-head">
            <div>
              <h3>Novas reservas</h3>
              <small>Criadas por dia no período</small>
            </div>
          </header>
          @if (carregandoFin()) {
            <div class="skel sk-chart"></div>
          } @else if (serieReservas().length) {
            <app-echart [option]="optReservas()" rotulo="Reservas criadas por dia" />
          } @else {
            <p class="d-vazio"><mat-icon>calendar_month</mat-icon> Nenhuma reserva no período.</p>
          }
        </section>

        <section class="d-card">
          <header class="d-card-head">
            <div>
              <h3>Receita por acomodação</h3>
              <small>Ranking do período</small>
            </div>
          </header>
          @if (carregandoFin()) {
            <div class="skel sk-chart"></div>
          } @else if (serieAcomodacao().length) {
            <app-echart [option]="optAcomodacao()" rotulo="Receita por acomodação" />
          } @else {
            <p class="d-vazio"><mat-icon>bar_chart</mat-icon> Nada recebido no período.</p>
          }
        </section>

        <section class="d-card">
          <header class="d-card-head">
            <div>
              <h3>Formas de pagamento</h3>
              <small>Participação no recebido</small>
            </div>
          </header>
          @if (carregandoFin()) {
            <div class="skel sk-chart"></div>
          } @else if (seriePagamento().length) {
            <app-echart [option]="optPagamento()" rotulo="Recebido por forma de pagamento" />
          } @else {
            <p class="d-vazio"><mat-icon>pie_chart</mat-icon> Nada recebido no período.</p>
          }
        </section>
      </div>

      <!-- ================= Operação do dia + últimas reservas ================= -->
      @if (!carregandoOps() && dados(); as d) {
        <div class="d-grid d-grid-c">
          <section class="d-card" id="tour-movimento">
            <header class="d-card-head">
              <div>
                <h3>Movimento de hoje</h3>
                <small>O que a recepção precisa executar</small>
              </div>
            </header>

            <div class="mov-sec">
              <div class="mov-tit">
                <mat-icon>login</mat-icon> Chegadas
                <span class="mov-n" [class.mov-pend]="d.checkins_pendentes.length > 0">
                  {{ d.checkins_pendentes.length }}
                </span>
              </div>
              <ul class="mov-lista">
                @for (p of d.checkins_pendentes; track p.idreserva) {
                  <li>
                    <a [routerLink]="['/reservas', p.idreserva]" class="mov-item">
                      <span class="mov-cli">{{ p.cliente_nome }}</span>
                      <span class="mov-aco">{{ p.acomodacao_nome }}</span>
                      <mat-icon class="mov-go">chevron_right</mat-icon>
                    </a>
                  </li>
                } @empty {
                  <li class="mov-vazio">Todos os check-ins de hoje foram realizados.</li>
                }
              </ul>
            </div>

            <div class="mov-sec">
              <div class="mov-tit">
                <mat-icon>logout</mat-icon> Saídas
                <span class="mov-n" [class.mov-pend]="d.checkouts_pendentes.length > 0">
                  {{ d.checkouts_pendentes.length }}
                </span>
              </div>
              <ul class="mov-lista">
                @for (p of d.checkouts_pendentes; track p.idreserva) {
                  <li>
                    <a [routerLink]="['/reservas', p.idreserva]" class="mov-item">
                      <span class="mov-cli">{{ p.cliente_nome }}</span>
                      <span class="mov-aco">{{ p.acomodacao_nome }}</span>
                      <mat-icon class="mov-go">chevron_right</mat-icon>
                    </a>
                  </li>
                } @empty {
                  <li class="mov-vazio">Todos os check-outs de hoje foram realizados.</li>
                }
              </ul>
            </div>
          </section>

          <section class="d-card" id="tour-reservas">
            <header class="d-card-head">
              <div>
                <h3>Últimas reservas</h3>
                <small>Mais recentes do sistema</small>
              </div>
              <a class="d-ver-tudo" [routerLink]="['/reservas']">
                Ver todas <mat-icon>arrow_forward</mat-icon>
              </a>
            </header>
            <div class="d-tab-wrap">
              <table class="d-tab">
                <thead>
                  <tr>
                    <th>Nº</th><th>Hóspede</th><th>Acomodação</th>
                    <th>Período</th><th class="tc">Situação</th><th class="tc"></th>
                  </tr>
                </thead>
                <tbody>
                  @for (r of d.ultimas_reservas.slice(0, 8); track r.id) {
                    <tr>
                      <td class="td-id">Nº {{ r.id }}</td>
                      <td>{{ r.cliente_nome }}</td>
                      <td>
                        <span class="aco-chip">
                          <i [style.background]="r.acomodacao_cor || '#1a6f8a'"></i>
                          {{ r.acomodacao_nome }}
                        </span>
                      </td>
                      <td class="td-per">
                        {{ r.entradaprevista | date: 'dd/MM' }} → {{ r.saidaprevista | date: 'dd/MM' }}
                      </td>
                      <td class="tc">
                        <span
                          class="status-chip"
                          [style.background]="statusCor(r.status)"
                          [style.color]="statusTexto(r.status)"
                        >
                          {{ statusRotulo(r.status) }}
                        </span>
                      </td>
                      <td class="tc">
                        <a class="badge-acao bg-blue1" [routerLink]="['/reservas', r.id]" title="Abrir reserva">
                          <mat-icon>visibility</mat-icon>
                        </a>
                      </td>
                    </tr>
                  } @empty {
                    <tr><td colspan="6" class="d-vazio-tab">Nenhuma reserva recente.</td></tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
        </div>
      }
    </div>
  `,
  styles: `
    /* ---------- cabeçalho ---------- */
    .d-head {
      display: flex; justify-content: space-between; align-items: flex-end;
      gap: 16px; flex-wrap: wrap;
      padding-bottom: 14px; margin-bottom: 14px;
      border-bottom: 1px solid #e3eaef;
    }
    .d-titulo {
      margin: 0; font-size: 1.5rem; font-weight: 800; color: #054054;
      letter-spacing: -0.02em;
    }
    .d-sub {
      margin: 2px 0 0; font-size: 0.82rem; color: #7d97a1;
      text-transform: capitalize;
    }
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

    /* ---------- slicer ---------- */
    .d-slicer {
      display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
      background: #fff; border: 1px solid #e3eaef; border-radius: 10px;
      padding: 10px 16px; margin-bottom: 14px;
    }
    .d-slicer-lbl {
      display: inline-flex; align-items: center; gap: 6px;
      font-size: 0.72rem; font-weight: 700; color: #7d97a1;
      text-transform: uppercase; letter-spacing: 0.06em;
    }
    .d-slicer-lbl mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .d-presets { display: flex; gap: 6px; flex-wrap: wrap; }
    .pre-btn {
      border: 1px solid #d7e0e6; background: #fff; color: #40525d;
      border-radius: 999px; padding: 6px 15px;
      font-size: 0.8rem; font-weight: 600; cursor: pointer; font-family: inherit;
      transition: all .14s ease;
    }
    .pre-btn:hover { border-color: #1a6f8a; color: #1a6f8a; }
    .pre-btn.ativo { background: #1a6f8a; border-color: #1a6f8a; color: #fff; }
    .d-slicer-per {
      margin-left: auto; font-size: 0.78rem; color: #8a99a4;
      font-variant-numeric: tabular-nums; white-space: nowrap;
    }

    /* ---------- KPI tiles (estilo Power BI) ---------- */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 12px; margin-bottom: 14px;
    }
    .kpi {
      background: #fff; border: 1px solid #e3eaef; border-radius: 10px;
      padding: 14px 16px 13px; display: flex; flex-direction: column; gap: 4px;
      min-width: 0;
    }
    .kpi-top { display: flex; justify-content: space-between; align-items: center; }
    .kpi-lbl {
      font-size: 0.66rem; font-weight: 700; color: #7d97a1;
      text-transform: uppercase; letter-spacing: 0.07em;
    }
    .kpi-ic { font-size: 17px; width: 17px; height: 17px; color: #c3d2d9; }
    .kpi-num {
      font-size: 1.6rem; font-weight: 800; color: #054054;
      line-height: 1.1; letter-spacing: -0.02em;
      font-variant-numeric: tabular-nums;
    }
    .kpi-num.kpi-din { font-size: 1.3rem; padding-top: 4px; }
    .kpi-num.kpi-prev { color: #1a6f8a; }
    .kpi-num.kpi-alerta { color: #b5811f; }
    .kpi-sub { font-size: 0.72rem; color: #8a99a4; }
    .kpi-bar {
      height: 5px; border-radius: 99px; background: #e9f0f4;
      overflow: hidden; margin: 2px 0;
    }
    .kpi-bar i {
      display: block; height: 100%; border-radius: 99px;
      background: linear-gradient(90deg, #1a6f8a, #4b95ab);
      transition: width .4s ease;
    }
    .kpi-skel { height: 96px; }

    /* ---------- cards de gráfico ---------- */
    .d-grid { display: grid; gap: 12px; margin-bottom: 14px; }
    .d-grid-a { grid-template-columns: 2fr 1fr; }
    .d-grid-b { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .d-grid-c { grid-template-columns: 1fr 2fr; }
    @media (max-width: 1100px) {
      .d-grid-b { grid-template-columns: 1fr 1fr; }
      .d-grid-c { grid-template-columns: 1fr; }
    }
    @media (max-width: 800px) {
      .d-grid-a, .d-grid-b { grid-template-columns: 1fr; }
    }
    .d-card {
      background: #fff; border: 1px solid #e3eaef; border-radius: 10px;
      padding: 16px 18px 12px; min-width: 0;
      display: flex; flex-direction: column;
    }
    .d-card-head {
      display: flex; justify-content: space-between; align-items: flex-start;
      gap: 12px; margin-bottom: 6px;
    }
    .d-card-head h3 { margin: 0; font-size: 0.95rem; font-weight: 700; color: #054054; }
    .d-card-head small { font-size: 0.74rem; color: #8a99a4; }
    .d-card-total {
      font-size: 1.05rem; font-weight: 800; color: #1a6f8a;
      font-variant-numeric: tabular-nums; white-space: nowrap;
    }
    .d-card app-echart { flex: 1; min-height: 230px; }
    .d-grid-a .d-card:first-child app-echart { min-height: 290px; }
    .d-grid-a .d-card:last-child app-echart { min-height: 290px; }

    .d-vazio {
      flex: 1; display: flex; align-items: center; justify-content: center;
      gap: 8px; min-height: 180px; margin: 0;
      color: #8a99a4; font-size: 0.85rem;
    }
    .d-vazio mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .d-vazio-tab { text-align: center; color: #8a99a4; padding: 28px 0 !important; }

    /* ---------- movimento de hoje ---------- */
    .mov-sec { padding: 6px 0 10px; }
    .mov-sec + .mov-sec { border-top: 1px solid #eef2f5; }
    .mov-tit {
      display: flex; align-items: center; gap: 7px;
      font-size: 0.78rem; font-weight: 700; color: #40525d;
      text-transform: uppercase; letter-spacing: 0.05em;
      padding: 6px 0 8px;
    }
    .mov-tit mat-icon { font-size: 16px; width: 16px; height: 16px; color: #1a6f8a; }
    .mov-n {
      margin-left: auto; background: #eef4f6; color: #1a6f8a;
      border-radius: 99px; min-width: 22px; height: 20px; padding: 0 7px;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 0.72rem; font-weight: 800;
    }
    .mov-n.mov-pend { background: #f7ead2; color: #b5811f; }
    .mov-lista { list-style: none; margin: 0; padding: 0; }
    .mov-item {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 10px; border-radius: 7px; text-decoration: none;
      transition: background .13s ease;
    }
    .mov-item:hover { background: #f2f7f9; }
    .mov-item:hover .mov-go { color: #1a6f8a; transform: translateX(2px); }
    .mov-cli { font-size: 0.88rem; font-weight: 600; color: #33424c; flex: 1; min-width: 0; }
    .mov-aco {
      font-size: 0.78rem; color: #7d97a1;
      background: #f2f6f8; border-radius: 99px; padding: 3px 10px;
      white-space: nowrap;
    }
    .mov-go { font-size: 18px; width: 18px; height: 18px; color: #c3d2d9; transition: all .13s; }
    .mov-vazio {
      padding: 10px; font-size: 0.82rem; color: #8a99a4;
      display: flex; align-items: center; gap: 6px;
    }

    /* ---------- ver tudo ---------- */
    .d-ver-tudo {
      display: inline-flex; align-items: center; gap: 4px;
      font-size: 0.78rem; font-weight: 600; color: #1a6f8a;
      text-decoration: none; white-space: nowrap;
    }
    .d-ver-tudo mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .d-ver-tudo:hover { text-decoration: underline; }

    /* ---------- tabela ---------- */
    .d-tab-wrap { overflow-x: auto; margin: 4px -6px 0; }
    .d-tab { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
    .d-tab thead th {
      background: #f4f8fa; color: #40525d;
      font-size: 0.72rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.05em; padding: 10px 14px; text-align: left;
      border-bottom: 2px solid #e3eaef; white-space: nowrap;
    }
    .d-tab tbody td {
      padding: 9px 14px; border-bottom: 1px solid #eef2f5;
      vertical-align: middle; color: #33424c;
    }
    .d-tab tbody tr:hover { background: #f7fafb; }
    .d-tab .tc { text-align: center; }
    .td-id { font-weight: 700; color: #054054; white-space: nowrap; }
    .td-per { white-space: nowrap; font-variant-numeric: tabular-nums; }
    .aco-chip { display: inline-flex; align-items: center; gap: 7px; white-space: nowrap; }
    .aco-chip i { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
    .status-chip {
      display: inline-block; padding: 3px 10px; border-radius: 99px;
      font-size: 0.74rem; font-weight: 700; white-space: nowrap;
    }
    .badge-acao {
      display: inline-flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; border-radius: 6px; color: #fff;
    }
    .badge-acao mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .badge-acao:hover { filter: brightness(1.12); }

    /* ---------- skeleton ---------- */
    .skel {
      border-radius: 10px;
      background: linear-gradient(90deg, #eef3f6 25%, #f7fafb 50%, #eef3f6 75%);
      background-size: 200% 100%;
      animation: shimmer 1.3s infinite;
    }
    @keyframes shimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }
    .sk-chart { height: 230px; border-radius: 8px; margin: 8px 0; }
  `,
})
export class DashboardComponent implements OnInit {
  private readonly rt = inject(Realtime);
  private readonly relatoriosApi = inject(RelatoriosApi);
  private readonly notify = inject(Notify);
  private readonly tour = inject(TourGuiado);

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
    let pendentes = 4;
    const ok = () => {
      if (--pendentes === 0) this.carregandoFin.set(false);
    };
    const erro = (e: unknown) => {
      this.notify.erro(e);
      ok();
    };
    this.relatoriosApi.resumoFinanceiro(i, f).subscribe({
      next: (r) => {
        this.resumo.set(r);
        ok();
      },
      error: erro,
    });
    this.relatoriosApi.serieRecebido(i, f).subscribe({
      next: (s) => {
        this.serieRecebido.set(s);
        ok();
      },
      error: erro,
    });
    this.relatoriosApi.serieReservas(i, f).subscribe({
      next: (s) => {
        this.serieReservas.set(s);
        ok();
      },
      error: erro,
    });
    this.relatoriosApi.seriePorPagamento(i, f).subscribe({
      next: (s) => {
        this.seriePagamento.set(s);
        ok();
      },
      error: erro,
    });
    this.relatoriosApi.seriePorAcomodacao(i, f).subscribe({
      next: (s) => this.serieAcomodacao.set(s),
      error: erro,
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
            x: 0, y: 0, x2: 0, y2: 1,
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
          itemStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 1, y2: 0,
              colorStops: [
                { offset: 0, color: '#054054' },
                { offset: 1, color: '#4b95ab' },
              ],
            },
          },
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
      formatter: ttItem(
        (p) => `${p.name}<br/><b>${p.value}</b> reserva(s)`,
      ),
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
      formatter: ttItem(
        (p) => `${p.name}<br/><b>${BRL.format(p.value)}</b>`,
      ),
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
            color: ['#054054', '#1a6f8a', '#4b95ab', '#b5811f', '#8ab4c4'][
              i % 5
            ],
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

  statusRotulo(s: string): string {
    return STATUS_RESERVA[s as keyof typeof STATUS_RESERVA]?.rotulo ?? s;
  }
  statusCor(s: string): string {
    return STATUS_RESERVA[s as keyof typeof STATUS_RESERVA]?.cor ?? '#7d97a1';
  }
  statusTexto(s: string): string {
    return STATUS_RESERVA[s as keyof typeof STATUS_RESERVA]?.texto ?? '#fff';
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
