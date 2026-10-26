import { Component, inject, signal, OnInit, effect } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ApiService, STATUS_RESERVA } from '@core/services/api.service';
import { DashboardResponse, ReservaResumo } from '@core/models/api.models';
import { Notify } from '@core/services/notify.service';
import { Realtime } from '@core/services/realtime.service';

type Painel = 'ultimas' | 'checkin' | 'checkout' | 'disponiveis' | 'ocupadas' | null;

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, DatePipe, MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="page">
      @if (carregando()) {
        <div class="center"><mat-spinner diameter="48" /></div>
      } @else if (dados(); as d) {
        <!-- info-boxes (linha superior do legado) -->
        <div class="grid-info">
          <div class="info-box">
            <span class="info-box-icon bg-blue"><mat-icon>group</mat-icon></span>
            <div class="info-box-content">
              <span>Hóspedes</span>
              <span class="info-box-number">{{ d.cards.hospedes_atuais }} atualmente</span>
            </div>
          </div>
          <div class="info-box">
            <span class="info-box-icon bg-success"><mat-icon>house</mat-icon></span>
            <div class="info-box-content">
              <span>Acomodações</span>
              <span class="info-box-number">{{ d.acomodacoes_disponiveis.length }} disponíveis</span>
            </div>
          </div>
          <div class="info-box">
            <span class="info-box-icon bg-blue1"><mat-icon>door_open</mat-icon></span>
            <div class="info-box-content">
              <span>Check-in realizados</span>
              <span class="info-box-number">{{ d.cards.checkins_hoje }} hoje</span>
            </div>
          </div>
          <div class="info-box">
            <span class="info-box-icon bg-danger"><mat-icon>door_back</mat-icon></span>
            <div class="info-box-content">
              <span>Check-out realizados</span>
              <span class="info-box-number">{{ d.cards.checkouts_hoje }} hoje</span>
            </div>
          </div>
        </div>

        <div class="grid-main">
          <!-- coluna de cards coloridos -->
          <div class="col-cards">
            <div class="card-dash bg-blue1 text-white">
              <div class="line-card">
                <span class="text-card">Últimas <br />reservas</span>
                <mat-icon class="icon-card">calendar_month</mat-icon>
              </div>
              <button class="footer-card" type="button" (click)="alternar('ultimas')">
                Visualizar <mat-icon>keyboard_double_arrow_right</mat-icon>
              </button>
            </div>

            <div class="card-dash bg-yellow text-black-50">
              <div class="line-card">
                <span class="text-card">Check-in <br />pendentes</span>
                <mat-icon class="icon-card">login</mat-icon>
              </div>
              <button class="footer-card" type="button" (click)="alternar('checkin')">
                Visualizar <mat-icon>keyboard_double_arrow_right</mat-icon>
              </button>
            </div>

            <div class="card-dash bg-danger text-white">
              <div class="line-card">
                <span class="text-card">Check-out <br />pendentes</span>
                <mat-icon class="icon-card">logout</mat-icon>
              </div>
              <button class="footer-card" type="button" (click)="alternar('checkout')">
                Visualizar <mat-icon>keyboard_double_arrow_right</mat-icon>
              </button>
            </div>

            <div class="card-dash bg-blue1 text-white">
              <div class="line-card">
                <span class="text-card">Acomodações <br />disponíveis</span>
                <mat-icon class="icon-card">house</mat-icon>
              </div>
              <button class="footer-card" type="button" (click)="alternar('disponiveis')">
                Visualizar <mat-icon>keyboard_double_arrow_right</mat-icon>
              </button>
            </div>

            <div class="card-dash bg-blue text-white">
              <div class="line-card">
                <span class="text-card">Acomodações <br />ocupadas</span>
                <mat-icon class="icon-card">holiday_village</mat-icon>
              </div>
              <button class="footer-card" type="button" (click)="alternar('ocupadas')">
                Visualizar <mat-icon>keyboard_double_arrow_right</mat-icon>
              </button>
            </div>
          </div>

          <!-- painel de dados -->
          <div class="card shadow-card">
            <div class="card-header-bar">
              <span>
                <mat-icon class="hd-ico">calendar_month</mat-icon> {{ tituloPainel() }}
              </span>
            </div>
            <div class="card-body">
              @switch (painel()) {
                @case ('checkin') {
                  <table class="plain">
                    <thead>
                      <tr><th>ID</th><th>Acomodação</th><th>Cliente</th><th>Ação</th></tr>
                    </thead>
                    <tbody>
                      @for (p of d.checkins_pendentes; track p.idreserva) {
                        <tr>
                          <td>{{ p.idreserva }}</td>
                          <td>{{ p.acomodacao_nome }}</td>
                          <td>{{ p.cliente_nome }}</td>
                          <td>
                            <a class="badge-card bg-blue1" [routerLink]="['/reservas', p.idreserva]" title="visualizar">
                              <mat-icon>visibility</mat-icon>
                            </a>
                          </td>
                        </tr>
                      } @empty {
                        <tr><td colspan="4" class="muted">Nenhum check-in pendente.</td></tr>
                      }
                    </tbody>
                  </table>
                }
                @case ('checkout') {
                  <table class="plain">
                    <thead>
                      <tr><th>ID</th><th>Acomodação</th><th>Cliente</th><th>Ação</th></tr>
                    </thead>
                    <tbody>
                      @for (p of d.checkouts_pendentes; track p.idreserva) {
                        <tr>
                          <td>{{ p.idreserva }}</td>
                          <td>{{ p.acomodacao_nome }}</td>
                          <td>{{ p.cliente_nome }}</td>
                          <td>
                            <a class="badge-card bg-blue1" [routerLink]="['/reservas', p.idreserva]" title="visualizar">
                              <mat-icon>visibility</mat-icon>
                            </a>
                          </td>
                        </tr>
                      } @empty {
                        <tr><td colspan="4" class="muted">Nenhum check-out pendente.</td></tr>
                      }
                    </tbody>
                  </table>
                }
                @case ('disponiveis') {
                  <table class="plain">
                    <thead>
                      <tr><th>ID</th><th>Acomodação</th></tr>
                    </thead>
                    <tbody>
                      @for (a of d.acomodacoes_disponiveis; track a.id) {
                        <tr><td>{{ a.id }}</td><td>{{ a.nome }}</td></tr>
                      } @empty {
                        <tr><td colspan="2" class="muted">Nenhuma acomodação disponível.</td></tr>
                      }
                    </tbody>
                  </table>
                }
                @case ('ocupadas') {
                  <table class="plain">
                    <thead>
                      <tr><th>ID</th><th>Acomodação</th></tr>
                    </thead>
                    <tbody>
                      @for (a of d.acomodacoes_ocupadas; track a.id) {
                        <tr><td>{{ a.id }}</td><td>{{ a.nome }}</td></tr>
                      } @empty {
                        <tr><td colspan="2" class="muted">Nenhuma acomodação ocupada.</td></tr>
                      }
                    </tbody>
                  </table>
                }
                @default {
                  <table class="plain">
                    <thead>
                      <tr>
                        <th>ID</th><th>Acomodação</th><th>Cliente</th>
                        <th>Entrada prevista</th><th>Saída prevista</th>
                        <th class="tc">Situação</th><th class="tc">Ação</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (r of ultimas7d(); track r.id) {
                        <tr>
                          <td>{{ r.id }}</td>
                          <td>{{ r.acomodacao_nome }}</td>
                          <td>{{ r.cliente_nome }}</td>
                          <td>{{ r.entradaprevista | date: 'dd/MM/yyyy' }}</td>
                          <td>{{ r.saidaprevista | date: 'dd/MM/yyyy' }}</td>
                          <td class="tc">
                            <span class="status-chip" [style.background]="statusCor(r.status)" [style.color]="statusTexto(r.status)">
                              {{ statusRotulo(r.status) }}
                            </span>
                          </td>
                          <td class="tc">
                            <a class="badge-card bg-blue1" [routerLink]="['/reservas', r.id]" title="visualizar">
                              <mat-icon>visibility</mat-icon>
                            </a>
                          </td>
                        </tr>
                      } @empty {
                        <tr><td colspan="7" class="muted">Nenhuma reserva nos últimos 7 dias.</td></tr>
                      }
                    </tbody>
                  </table>
                }
              }
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: `
    .center { display: grid; place-items: center; padding: 80px; }

    .grid-info {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 1rem;
      margin-top: 1rem;
    }
    .info-box-icon mat-icon { font-size: 30px; width: 30px; height: 30px; }

    .grid-main {
      display: grid;
      grid-template-columns: minmax(220px, 1fr) 3fr;
      gap: 1rem;
      align-items: start;
    }

    .col-cards { display: flex; flex-direction: column; gap: 1rem; }

    .card-dash {
      height: 6rem;
      border-radius: 0.25rem;
      box-shadow: 0 0 1px rgba(0, 0, 0, 0.125), 0 1px 3px rgba(0, 0, 0, 0.3);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .line-card {
      height: 75%;
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.75rem 1rem;
    }
    .text-card { font-weight: 700; font-family: sans-serif; font-size: 0.95rem; }
    .icon-card { color: rgba(0, 0, 0, 0.4); font-size: 2.4rem; width: 2.4rem; height: 2.4rem; }
    .footer-card {
      height: 25%;
      border: none;
      cursor: pointer;
      background-color: rgba(0, 0, 0, 0.1);
      color: inherit;
      font-family: inherit;
      font-weight: 700;
      font-size: 0.8rem;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      transition: 0.2s ease;
    }
    .footer-card:hover { background-color: rgba(0, 0, 0, 0.2); }
    .footer-card mat-icon { font-size: 15px; width: 15px; height: 15px; }

    .shadow-card {
      background: #fff;
      border-radius: 0.25rem;
      box-shadow: 0 0.5rem 1rem rgba(0, 0, 0, 0.15);
      overflow: hidden;
    }
    .card-header-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.75rem 1rem;
      border-bottom: 1px solid rgba(0, 0, 0, 0.125);
      background: rgba(0, 0, 0, 0.03);
      font-weight: 600;
      font-size: 0.95rem;
    }
    .hd-ico { font-size: 18px; width: 18px; height: 18px; vertical-align: -3px; margin-right: 4px; }
    .card-body { padding: 0.75rem; }

    .badge-card {
      display: inline-flex;
      align-items: center;
      padding: 0.35em 0.55em;
      border-radius: 0.25rem;
      color: #fff;
      cursor: pointer;
    }
    .badge-card mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .badge-card:hover { filter: brightness(0.9); }

    .tc { text-align: center; }

    @media (max-width: 992px) {
      .grid-main { grid-template-columns: 1fr; }
      .col-cards { flex-direction: row; flex-wrap: wrap; }
      .col-cards .card-dash { flex: 1 1 220px; }
    }
  `,
})
export class DashboardComponent implements OnInit {
  private readonly rt = inject(Realtime);

  constructor() {
    let ultimo = -1;
    effect(() => {
      const v = this.rt.mudanca('reserva', 'consumo', 'item_consumido');
      if (ultimo < 0) {
        ultimo = v;
        return;
      }
      if (v !== ultimo) {
        ultimo = v;
        this.carregar();
      }
    });
  }
  private readonly api = inject(ApiService);
  private readonly notify = inject(Notify);

  protected readonly carregando = signal(true);
  protected readonly dados = signal<DashboardResponse | null>(null);
  protected readonly ultimas7d = signal<ReservaResumo[]>([]);
  protected readonly painel = signal<Painel>('ultimas');

  ngOnInit(): void {
    this.carregar();
  }

  carregar(): void {
    this.carregando.set(true);
    this.api.dashboard().subscribe({
      next: (d) => {
        this.dados.set(d);
        this.carregando.set(false);
      },
      error: (e) => {
        this.carregando.set(false);
        this.notify.erro(e);
      },
    });
    const fim = new Date();
    const inicio = new Date();
    inicio.setDate(inicio.getDate() - 7);
    this.api
      .eventosReserva(inicio.toISOString().slice(0, 10), fim.toISOString().slice(0, 10))
      .subscribe({ next: (r) => this.ultimas7d.set(r), error: () => undefined });
  }

  alternar(p: Exclude<Painel, null>): void {
    this.painel.set(this.painel() === p ? 'ultimas' : p);
  }

  tituloPainel(): string {
    switch (this.painel()) {
      case 'checkin': return 'Check-ins pendentes';
      case 'checkout': return 'Check-outs pendentes';
      case 'disponiveis': return 'Acomodações disponíveis';
      case 'ocupadas': return 'Acomodações ocupadas';
      default: return 'Reservas nos últimos 7 dias';
    }
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
