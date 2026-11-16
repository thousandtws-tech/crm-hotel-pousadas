import { Component, inject, signal, OnInit, effect } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { DatePipe, JsonPipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatExpansionModule } from '@angular/material/expansion';
import { RelatoriosApi } from '@core/api/relatorios.api';
import { RegistroLog } from '@core/models/relatorios.models';
import { Notify } from '@core/services/notify.service';
import { Realtime } from '@core/services/realtime.service';
import { DateInputComponent } from '@shared/components/date-input.component';

@Component({
  selector: 'app-auditoria',
  imports: [
    DatePipe,
    JsonPipe,
    ReactiveFormsModule,
    MatCardModule,
    MatTableModule,
    MatPaginatorModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatExpansionModule,
    DateInputComponent,
  ],
  template: `
    <div class="page">
      <div class="page-header"><h1>Auditoria</h1></div>

      <div class="filtros">
        <label class="fdata">
          <span>Tabela</span>
          <mat-form-field appearance="outline" subscriptSizing="dynamic" class="campo-mat">
            <input matInput [formControl]="fTabela" placeholder="reserva, cliente…" />
          </mat-form-field>
        </label>
        <label class="fdata">
          <span>Ação</span>
          <mat-form-field appearance="outline" subscriptSizing="dynamic" class="campo-mat">
            <input matInput [formControl]="fAcao" placeholder="checkin, edição…" />
          </mat-form-field>
        </label>
        <label class="fdata">
          <span>Desde</span>
          <app-date [formControl]="fDesde" />
        </label>
        <label class="fdata">
          <span>Até</span>
          <app-date [formControl]="fAte" />
        </label>
        <button class="btn-filtrar" mat-stroked-button (click)="recarregar()">
          <mat-icon>filter_alt</mat-icon> Filtrar
        </button>
      </div>

      <mat-accordion>
        @for (l of items(); track l.id) {
          <mat-expansion-panel>
            <mat-expansion-panel-header>
              <mat-panel-title>
                <span class="acao">{{ l.acao }}</span>
                <span class="muted">{{ l.tabela ?? '—' }} #{{ l.idtabela ?? '—' }}</span>
              </mat-panel-title>
              <mat-panel-description>
                {{ l.criado_em | date: 'dd/MM/yyyy HH:mm:ss' }}
              </mat-panel-description>
            </mat-expansion-panel-header>
            <p>{{ l.obs }}</p>
            @if (l.dados) {
              <pre class="dados">{{ l.dados | json }}</pre>
            }
          </mat-expansion-panel>
        } @empty {
          <p class="muted" style="padding: 16px">Nenhum registro.</p>
        }
      </mat-accordion>

      <mat-paginator
        [length]="total()"
        [pageSize]="50"
        [pageIndex]="pagina() - 1"
        (page)="mudouPagina($event)"
      />
    </div>
  `,
  styles: `
    .filtros { display: flex; gap: 12px; align-items: flex-end; margin-bottom: 12px; flex-wrap: wrap; }
    .fdata { display: flex; flex-direction: column; gap: 4px; width: 180px; }
    .fdata > span { font-size: 12px; color: #55606d; font-weight: 600; }
    .fdata .campo-mat { width: 100%; }
    .btn-filtrar {
      height: 32px; min-height: 32px; border-radius: 6px;
      font-size: 0.85rem;
      --mat-sys-primary: #2457a7;
      --mat-sys-outline: #b9c4cb;
    }
    .btn-filtrar mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .acao {
      background: var(--mat-sys-primary-container);
      border-radius: 6px; padding: 2px 10px;
      font-size: 13px; margin-right: 10px;
    }
    .dados {
      background: #161a20; color: #dbe9f5;
      padding: 12px; border-radius: 8px; font-size: 12px;
      overflow-x: auto;
    }
  `,
})
export class AuditoriaComponent implements OnInit {
  private readonly rt = inject(Realtime);

  constructor() {
    let ultimo = -1;
    effect(() => {
      const v = this.rt.mudanca('log');
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
  private readonly relatoriosApi = inject(RelatoriosApi);
  private readonly notify = inject(Notify);
  private readonly fb = inject(FormBuilder);

  protected readonly items = signal<RegistroLog[]>([]);
  protected readonly total = signal(0);
  protected readonly pagina = signal(1);

  protected readonly fTabela = this.fb.control<string | null>(null);
  protected readonly fAcao = this.fb.control<string | null>(null);
  protected readonly fDesde = this.fb.control<string | null>(null);
  protected readonly fAte = this.fb.control<string | null>(null);

  ngOnInit(): void {
    this.carregar();
  }

  carregar(): void {
    this.relatoriosApi.logs({
        tabela: this.fTabela.value || null,
        acao: this.fAcao.value || null,
        desde: this.fDesde.value,
        ate: this.fAte.value,
        page: this.pagina(),
        porPagina: 50,
      })
      .subscribe({
        next: (p) => {
          this.items.set(p.items);
          this.total.set(p.total);
        },
        error: (e) => this.notify.erro(e),
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
}
