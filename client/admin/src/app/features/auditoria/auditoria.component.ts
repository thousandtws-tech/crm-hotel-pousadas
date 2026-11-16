import { Component, inject, signal, OnInit, effect } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { DatePipe, JsonPipe } from '@angular/common';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatIconModule } from '@angular/material/icon';
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
    MatPaginatorModule,
    MatIconModule,
    DateInputComponent,
  ],
  template: `
    <div class="page">
      <div class="aud-head">
        <div>
          <p class="eyebrow">Configurações</p>
          <h2 class="aud-titulo">Auditoria</h2>
          <p class="aud-sub">Registro das ações feitas no sistema — quem fez, quando e o que mudou</p>
        </div>
        <span class="aud-total">{{ total() }} registro{{ total() === 1 ? '' : 's' }}</span>
      </div>

      <div class="inner-card aud-card">
        <div class="aud-filtros">
          <label class="aud-f">
            <span>Tabela</span>
            <input
              class="aud-input" type="text" [formControl]="fTabela"
              placeholder="reserva, cliente…" aria-label="Filtrar por tabela"
            />
          </label>
          <label class="aud-f">
            <span>Ação</span>
            <input
              class="aud-input" type="text" [formControl]="fAcao"
              placeholder="checkin, edição…" aria-label="Filtrar por ação"
            />
          </label>
          <label class="aud-f">
            <span>Desde</span>
            <app-date [formControl]="fDesde" />
          </label>
          <label class="aud-f">
            <span>Até</span>
            <app-date [formControl]="fAte" />
          </label>
          <button class="btn-dark-blue aud-filtrar" type="button" (click)="recarregar()">
            <mat-icon>filter_alt</mat-icon> Filtrar
          </button>
        </div>

        <div class="aud-lista" id="tour-lista">
          @if (carregando()) {
            @for (s of skel; track s) {
              <div class="aud-item">
                <div class="aud-linha">
                  <span class="skel sk-acao"></span>
                  <span class="skel sk-alvo"></span>
                  <span class="skel sk-autor"></span>
                  <span class="skel sk-data"></span>
                </div>
              </div>
            }
          } @else {
            @for (l of items(); track l.id) {
              <div class="aud-item" [class.aberto]="aberto() === l.id">
                <button
                  type="button" class="aud-linha"
                  (click)="alternar(l.id)"
                  [attr.aria-expanded]="aberto() === l.id"
                >
                  <span class="aud-acao">{{ l.acao }}</span>
                  <span class="aud-alvo">{{ l.tabela ?? '—' }} · #{{ l.idtabela ?? '—' }}</span>
                  <span class="aud-autor">{{ l.funcionario_nome ?? 'sistema' }}</span>
                  <span class="aud-data">{{ l.criado_em | date: 'dd/MM/yyyy HH:mm:ss' }}</span>
                  <mat-icon class="aud-seta">expand_more</mat-icon>
                </button>
                @if (aberto() === l.id) {
                  <div class="aud-detalhe">
                    @if (l.obs) {
                      <p class="aud-obs">{{ l.obs }}</p>
                    }
                    @if (l.dados) {
                      <pre class="aud-dados">{{ l.dados | json }}</pre>
                    }
                    @if (!l.obs && !l.dados) {
                      <p class="aud-obs mut">Sem detalhes adicionais.</p>
                    }
                  </div>
                }
              </div>
            } @empty {
              <div class="aud-vazio">
                <mat-icon>history</mat-icon>
                Nenhum registro encontrado para os filtros aplicados.
              </div>
            }
          }
        </div>

        <mat-paginator
          [length]="total()"
          [pageSize]="50"
          [pageIndex]="pagina() - 1"
          (page)="mudouPagina($event)"
        />
      </div>
    </div>
  `,
  styles: `
    .aud-head {
      display: flex; justify-content: space-between; align-items: flex-end;
      gap: 16px; flex-wrap: wrap;
      padding-bottom: 14px; margin-bottom: 16px;
      border-bottom: 1px solid #e3eaef;
    }
    .aud-titulo { margin: 0; font-size: 1.5rem; font-weight: 800; color: #054054; letter-spacing: -0.02em; }
    .aud-sub { margin: 4px 0 0; font-size: 0.82rem; color: #7d97a1; }
    .aud-total { font-size: 0.8rem; font-weight: 600; color: #536b73; white-space: nowrap; }

    .aud-card { padding: 14px 18px 10px; }
    .aud-filtros {
      display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap;
      padding-bottom: 14px; border-bottom: 1px solid #eef2f5;
    }
    .aud-f { display: flex; flex-direction: column; gap: 4px; }
    .aud-f > span { font-size: 0.74rem; font-weight: 600; color: #536b73; }
    .aud-input {
      height: 36px; min-width: 180px; padding: 0 10px;
      border: 1px solid #dce6ea; border-radius: 6px; background: #fff;
      font-size: 0.85rem; color: #33424c; font-family: inherit;
    }
    .aud-input::placeholder { color: #8fa3ab; }
    .aud-input:focus { border-color: #054054; outline: none; box-shadow: 0 0 0 3px rgba(5, 64, 84, 0.1); }
    .aud-filtrar { display: inline-flex; align-items: center; gap: 6px; }
    .aud-filtrar mat-icon { font-size: 17px; width: 17px; height: 17px; }

    .aud-lista { display: flex; flex-direction: column; }
    .aud-item { border-bottom: 1px solid #eef2f5; }
    .aud-item:last-child { border-bottom: none; }
    .aud-linha {
      display: grid; grid-template-columns: 130px minmax(0, 1.2fr) minmax(0, 1fr) 150px 24px;
      align-items: center; gap: 10px;
      width: 100%; padding: 11px 2px; border: none; background: none;
      font-family: inherit; text-align: left; cursor: pointer;
    }
    .aud-linha:hover { background: #f7fafb; }
    .aud-linha:focus-visible { outline: 2px solid #054054; outline-offset: -2px; border-radius: 4px; }
    .aud-acao {
      display: inline-flex; justify-content: center;
      background: #eef4f6; color: #054054;
      border-radius: 999px; padding: 3px 10px;
      font-size: 0.75rem; font-weight: 600;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .aud-alvo { font-size: 0.85rem; color: #33424c; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .aud-autor { font-size: 0.8rem; color: #536b73; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .aud-data {
      font-size: 0.78rem; color: #8fa3ab; text-align: right;
      font-variant-numeric: tabular-nums; white-space: nowrap;
    }
    .aud-seta { font-size: 20px; width: 20px; height: 20px; color: #8fa3ab; transition: transform .15s; }
    .aud-item.aberto .aud-seta { transform: rotate(180deg); }
    .aud-detalhe { padding: 0 2px 14px; display: flex; flex-direction: column; gap: 8px; }
    .aud-obs { margin: 0; font-size: 0.84rem; color: #33424c; line-height: 1.5; }
    .aud-obs.mut { color: #8fa3ab; }
    .aud-dados {
      margin: 0; background: #032b38; color: #cfe0e8;
      padding: 12px 14px; border-radius: 8px; font-size: 0.75rem; line-height: 1.55;
      overflow-x: auto; max-height: 260px; overflow-y: auto;
    }
    .aud-vazio {
      text-align: center; color: #8fa3ab; padding: 40px 16px; font-size: 0.86rem;
    }
    .aud-vazio mat-icon { display: block; margin: 0 auto 8px; font-size: 30px; width: 30px; height: 30px; color: #c3d2d9; }

    .skel { display: block; border-radius: 4px; background: #eef4f6; height: 13px; }
    .sk-acao { width: 76px; height: 22px; border-radius: 999px; }
    .sk-alvo { width: 180px; }
    .sk-autor { width: 110px; }
    .sk-data { width: 120px; margin-left: auto; }

    @media (max-width: 860px) {
      .aud-linha { grid-template-columns: 110px minmax(0, 1fr) 24px; }
      .aud-autor { display: none; }
      .aud-data { grid-column: 2; text-align: left; }
      .aud-seta { grid-column: 3; grid-row: 1; }
    }
  `,
})
export class AuditoriaComponent implements OnInit {
  private readonly rt = inject(Realtime);
  private readonly relatoriosApi = inject(RelatoriosApi);
  private readonly notify = inject(Notify);
  private readonly fb = inject(FormBuilder);

  protected readonly items = signal<RegistroLog[]>([]);
  protected readonly total = signal(0);
  protected readonly pagina = signal(1);
  protected readonly carregando = signal(true);
  protected readonly aberto = signal<number | null>(null);
  protected readonly skel = [0, 1, 2, 3, 4, 5];

  protected readonly fTabela = this.fb.control<string | null>(null);
  protected readonly fAcao = this.fb.control<string | null>(null);
  protected readonly fDesde = this.fb.control<string | null>(null);
  protected readonly fAte = this.fb.control<string | null>(null);

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

  ngOnInit(): void {
    this.carregar();
  }

  alternar(id: number): void {
    this.aberto.update((a) => (a === id ? null : id));
  }

  carregar(): void {
    this.carregando.set(true);
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
}
