import { Component, inject, signal, OnInit, effect } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ApiService, STATUS_RESERVA } from '@core/services/api.service';
import { ReservaResumo, StatusReserva } from '@core/models/api.models';
import { Notify } from '@core/services/notify.service';
import { Realtime } from '@core/services/realtime.service';
import { NovaReservaDialogComponent } from './nova-reserva-dialog.component';

@Component({
  selector: 'app-reservas',
  imports: [
    RouterLink,
    DatePipe,
    ReactiveFormsModule,
    MatPaginatorModule,
    MatIconModule,
    MatProgressSpinnerModule,
    NovaReservaDialogComponent,
  ],
  template: `
    <div class="page">
      <div class="page-header">
        <h1>Reservas</h1>
        <button class="btn-dark-blue" type="button" (click)="novaReserva()">
          <mat-icon>calendar_month</mat-icon> Nova Reserva
        </button>
      </div>

      <div class="inner-card" style="margin-top:0">
        <div class="inner-card-header">RESERVAS</div>
        <div class="inner-card-body">
          <p class="res-sub">Todas reservas registradas</p>
          <div class="res-filtros">
            <div class="badges-filtro">
              <button
                type="button"
                class="badge-f bg-secondary2"
                [class.selecionada]="fStatus.value === ''"
                (click)="filtrarStatus('')"
              >Todas</button>
              <button
                type="button"
                class="badge-f bg-warning text-black-50"
                [class.selecionada]="fStatus.value === 'p'"
                (click)="filtrarStatus('p')"
              >Pendente</button>
              <button
                type="button"
                class="badge-f bg-blue1"
                [class.selecionada]="fStatus.value === 'i'"
                (click)="filtrarStatus('i')"
              >Iniciado</button>
              <button
                type="button"
                class="badge-f bg-success"
                [class.selecionada]="fStatus.value === 'f'"
                (click)="filtrarStatus('f')"
              >Finalizado</button>
              <button
                type="button"
                class="badge-f bg-danger"
                [class.selecionada]="fStatus.value === 'c'"
                (click)="filtrarStatus('c')"
              >Cancelado</button>
            </div>

            <form class="res-busca" (ngSubmit)="recarregar()">
              <div class="input-group-inn">
                <input
                  class="input-inn"
                  placeholder="Cliente, acomodação ou nº da reserva"
                  [formControl]="fBusca"
                  aria-label="Pesquisar reservas"
                />
                <button class="btn-dark-blue" type="submit" aria-label="Buscar">
                  <mat-icon>search</mat-icon> Buscar
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

      @if (carregando()) {
        <div class="center"><mat-spinner diameter="40" /></div>
      } @else if (items().length === 0) {
        <div class="res-vazio"><h5>Nenhum registro encontrado</h5></div>
      } @else {
        <div class="res-grid">
          @for (r of items(); track r.id) {
            <article class="res-card">
              <header
                class="res-card-top"
                [style.background]="corTop(r.status)"
                [style.color]="corTexto(r.status)"
              >
                <mat-icon>cottage</mat-icon>
                {{ r.acomodacao_nome }}
                <small>Nº{{ r.acomodacao_numero }}</small>
              </header>
              <div class="res-card-body">
                <span class="res-linha">
                  <mat-icon>calendar_month</mat-icon> Reserva Nº{{ r.id }}
                </span>
                <span class="res-linha">
                  <mat-icon>person</mat-icon> {{ r.cliente_nome }}
                </span>
                <span class="res-linha">
                  <mat-icon>event</mat-icon>
                  {{ r.entradaprevista | date: 'dd/MM/yyyy' }} —
                  {{ r.saidaprevista | date: 'dd/MM/yyyy' }}
                </span>
                <a
                  class="btn-dark-blue res-ver"
                  [routerLink]="['/reservas', r.id]"
                >Visualizar</a>
              </div>
            </article>
          }
        </div>

        <mat-paginator
          [length]="total()"
          [pageSize]="24"
          [pageIndex]="pagina() - 1"
          (page)="mudouPagina($event)"
        />
      }
    </div>

    @if (modalNova()) {
      <app-nova-reserva-dialog
        (fechar)="modalNova.set(false)"
        (criada)="reservaCriada()"
      />
    }
  `,
  styles: `
    .res-sub {
      margin: 0 0 12px;
      font-size: 1rem;
      font-weight: 600;
      color: #212529;
      text-align: center;
    }
    .res-filtros {
      display: flex; justify-content: space-between; align-items: center;
      gap: 12px; flex-wrap: wrap;
    }
    .badges-filtro {
      display: flex; gap: 6px; flex-wrap: wrap;
    }
    .badge-f {
      border: none;
      border-radius: 0.25rem;
      padding: 0.4em 0.7em;
      font-size: 0.75em;
      font-weight: 700;
      color: #fff;
      cursor: pointer;
      font-family: inherit;
      opacity: 0.75;
    }
    .badge-f:hover { opacity: 1; }
    .badge-f.selecionada {
      opacity: 1;
      outline: 2px solid rgba(0, 0, 0, 0.35);
    }
    .res-busca .input-group-inn { display: flex; }
    .res-busca .input-inn { width: 260px; }
    .res-busca .btn-dark-blue {
      border-radius: 0 4px 4px 0;
      display: inline-flex; align-items: center; gap: 4px;
      white-space: nowrap;
    }
    .res-busca .btn-dark-blue mat-icon { font-size: 16px; width: 16px; height: 16px; }

    .res-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: 14px;
      margin-top: 14px;
    }
    .res-card {
      background: #fff;
      border: 1px solid rgba(0, 0, 0, 0.125);
      border-radius: 0.2rem;
      box-shadow: 0 0.125rem 0.25rem rgba(0, 0, 0, 0.075);
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .res-card-top {
      padding: 10px;
      font-size: 0.9rem;
      font-weight: 600;
      display: flex; align-items: center; gap: 6px;
    }
    .res-card-top mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .res-card-top small { font-weight: 400; vertical-align: top; }
    .res-card-body {
      padding: 12px;
      display: flex; flex-direction: column; gap: 6px;
      font-size: 0.9rem;
      flex: 1;
    }
    .res-linha { display: flex; align-items: center; gap: 6px; color: #333; }
    .res-linha mat-icon { font-size: 16px; width: 16px; height: 16px; color: #5d6d7e; }
    .res-ver {
      margin-top: 8px;
      display: block;
      text-align: center;
      text-decoration: none;
      border-radius: 2px;
      padding: 0.35rem 0;
      font-size: 0.85rem;
    }
    .center { display: grid; place-items: center; padding: 32px; }
    .res-vazio { text-align: center; padding: 48px 0; color: #6c757d; }
    @media (max-width: 700px) {
      .res-busca, .res-busca .input-group-inn, .res-busca .input-inn { width: 100%; }
    }
  `,
})
export class ReservasComponent implements OnInit {
  private readonly rt = inject(Realtime);
  private readonly api = inject(ApiService);
  private readonly notify = inject(Notify);
  private readonly fb = inject(FormBuilder);

  protected readonly modalNova = signal(false);
  protected readonly items = signal<ReservaResumo[]>([]);
  protected readonly total = signal(0);
  protected readonly pagina = signal(1);
  protected readonly carregando = signal(false);

  protected readonly fBusca = this.fb.control<string>('');
  protected readonly fStatus = this.fb.control<StatusReserva | ''>('');

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
        this.carregar();
      }
    });
  }

  filtrarStatus(s: StatusReserva | ''): void {
    this.fStatus.setValue(s);
    this.recarregar();
  }

  ngOnInit(): void {
    this.carregar();
  }

  carregar(): void {
    this.carregando.set(true);
    this.api
      .listarReservas({
        busca: this.fBusca.value?.trim() || null,
        status: this.fStatus.value || null,
        page: this.pagina(),
        porPagina: 24,
      })
      .subscribe({
        next: (p) => {
          this.items.set(p.items);
          this.total.set(p.total);
          this.carregando.set(false);
        },
        error: (e) => {
          this.carregando.set(false);
          this.notify.erro(e);
        },
      });
  }

  recarregar(): void {
    this.pagina.set(1);
    this.carregar();
  }

  mudouPagina(e: PageEvent): void {
    this.pagina.set(e.pageIndex + 1);
    this.carregar();
  }

  novaReserva(): void {
    this.modalNova.set(true);
  }

  reservaCriada(): void {
    this.modalNova.set(false);
    this.notify.ok('Reserva criada.');
    this.carregar();
  }

  /** Cor da faixa do card — mesma regra do legado (statusReserva). */
  corTop(s: StatusReserva): string {
    return STATUS_RESERVA[s].cor;
  }
  corTexto(s: StatusReserva): string {
    return STATUS_RESERVA[s].texto;
  }
}
