// Café da manhã — quadro de presença por reserva/dia.
// Layout: prancha UX/UI "Café da Manhã" (26:631).
// Realtime: deltas de cafe_presenca recarregam o quadro (mesma infra do KDS).

import {
  Component, OnDestroy, OnInit, computed, effect, inject, signal,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { DateInputComponent } from '@shared/components/date-input.component';
import { CafeApi } from '@core/api/cafe.api';
import { Realtime } from '../../core/services/realtime.service';
import { Notify } from '../../core/services/notify.service';
import { CafeQuadroItem } from '@core/models/cafe.models';

type FiltroPresenca = 'todas' | 'aguardando' | 'presentes';

@Component({
  selector: 'app-cafe',
  imports: [MatIconModule, DateInputComponent],
  template: `
    <div class="page cafe">
      <header class="cafe-head">
        <div>
          <p class="eyebrow">Operação</p>
          <h2 class="titulo">Café da Manhã</h2>
          <p class="sub">Encontre a reserva e registre a presença no café.</p>
        </div>
        <div class="dia-box">
          <span class="lbl">Data do café</span>
          <div class="dia-nav" role="group" aria-label="Navegar dia">
            <button type="button" class="nav-dia" (click)="mudarDia(-1)" aria-label="Dia anterior">
              <mat-icon>chevron_left</mat-icon>
            </button>
            <div class="dia-input">
              <app-date [value]="dia()" (alterar)="definirDia($event)" rotulo="Data do quadro" />
            </div>
            <button type="button" class="nav-dia" (click)="mudarDia(1)" aria-label="Próximo dia">
              <mat-icon>chevron_right</mat-icon>
            </button>
          </div>
          @if (!ehHoje()) {
            <button type="button" class="hoje" (click)="hoje()">Voltar para hoje</button>
          }
        </div>
      </header>

      <div class="stats">
        <div class="stat">
          <div><span class="stat-l">Reservas na casa</span>
            <p><strong>{{ quadro().length }}</strong>
              <small>{{ quadro().length === 1 ? 'reserva' : 'reservas' }}</small></p></div>
          <span class="stat-ico"><mat-icon>king_bed</mat-icon></span>
        </div>
        <div class="stat">
          <div><span class="stat-l">Reservas presentes</span>
            <p><strong>{{ presentes() }}</strong>
              <small>{{ presentes() === 1 ? 'reserva' : 'reservas' }}</small></p></div>
          <span class="stat-ico"><mat-icon>check_circle</mat-icon></span>
        </div>
        <div class="stat">
          <div><span class="stat-l">Pessoas servidas</span>
            <p><strong>{{ pessoasServidas() }}</strong>
              <small>{{ pessoasServidas() === 1 ? 'pessoa' : 'pessoas' }}</small></p></div>
          <span class="stat-ico"><mat-icon>groups</mat-icon></span>
        </div>
      </div>

      <div class="sec-head">
        <h3>Presença no café</h3>
        <span>{{ aguardando() }} {{ aguardando() === 1 ? 'reserva aguardando' : 'reservas aguardando' }}</span>
      </div>

      <section class="quadro-card">
        <header class="q-head">
          <div class="q-busca">
            <span class="lbl">Buscar reserva</span>
            <input class="inp" placeholder="Quarto ou nome do hóspede" [value]="busca()"
                   (input)="busca.set($any($event.target).value)"
                   aria-label="Buscar por quarto ou hóspede" />
          </div>
          <div class="seg" role="group" aria-label="Filtrar presença">
            @for (f of filtros; track f.v) {
              <button type="button" class="seg-btn" [class.ativo]="filtro() === f.v"
                      (click)="filtro.set(f.v)">
                {{ f.rotulo }} <b>{{ contagemFiltro(f.v) }}</b>
              </button>
            }
          </div>
        </header>

        @if (carregando()) {
          <div class="q-vazio"><mat-icon>hourglass_top</mat-icon>Carregando…</div>
        } @else if (quadro().length === 0) {
          <div class="q-vazio"><mat-icon>king_bed</mat-icon>
            Nenhuma reserva em estadia em {{ diaFormatado() }}.</div>
        } @else {
          <div class="q-tab" role="table" aria-label="Presença por reserva">
            <div class="q-th" role="row">
              <span role="columnheader">Quarto / Hóspede</span>
              <span role="columnheader">Pessoas</span>
              <span role="columnheader">Presença</span>
              <span role="columnheader">Ação</span>
            </div>
            @for (r of quadroFiltrado(); track r.idreserva) {
              <div class="q-tr" role="row">
                <div class="q-hospede">
                  <span class="q-tile">
                    <small>{{ r.quarto_numero ? 'Quarto' : 'Acomodação' }}</small>
                    <b>{{ r.quarto_numero ?? r.acomodacao_nome }}</b>
                  </span>
                  <span class="q-nome">
                    <strong>{{ r.cliente_nome }}</strong>
                    <small>Reserva de {{ r.quantidade_hospedes }}
                      {{ r.quantidade_hospedes === 1 ? 'hóspede' : 'hóspedes' }}</small>
                  </span>
                </div>
                <div class="q-pessoas">{{ r.quantidade_hospedes }}
                  {{ r.quantidade_hospedes === 1 ? 'hóspede' : 'hóspedes' }}</div>
                <div class="q-presenca">
                  @if (r.presenca_id !== null) {
                    <span class="pill ok">
                      {{ r.presenca_quantidade }}/{{ r.quantidade_hospedes }} · {{ hora(r.presenca_em!) }}
                    </span>
                  } @else {
                    <span class="pill aguarda">Aguardando</span>
                  }
                </div>
                <div class="q-acao">
                  @if (r.presenca_id === null) {
                    @if (escolhendo() === r.idreserva) {
                      <div class="stepper" role="group" aria-label="Quantas pessoas">
                        <div class="stepper-linha">
                          <button type="button" class="passo" (click)="passo(-1, r)"
                                  [disabled]="qtd() <= 1" aria-label="Menos uma pessoa">
                            <mat-icon>remove</mat-icon>
                          </button>
                          <span class="qtd" aria-live="polite">{{ qtd() }}</span>
                          <button type="button" class="passo" (click)="passo(1, r)"
                                  [disabled]="qtd() >= r.quantidade_hospedes"
                                  aria-label="Mais uma pessoa">
                            <mat-icon>add</mat-icon>
                          </button>
                        </div>
                        <div class="stepper-acoes">
                          <button type="button" class="confirmar" [disabled]="ocupando()"
                                  (click)="confirmar(r)">
                            <mat-icon>check</mat-icon>Confirmar
                          </button>
                          <button type="button" class="fechar" (click)="escolhendo.set(0)"
                                  aria-label="Cancelar"><mat-icon>close</mat-icon></button>
                        </div>
                      </div>
                    } @else {
                      <button type="button" class="btn-marcar" (click)="abrir(r)">
                        Marcar presença
                      </button>
                      <small class="q-nota">Para esta reserva · {{ r.quantidade_hospedes }}
                        {{ r.quantidade_hospedes === 1 ? 'hóspede' : 'hóspedes' }}</small>
                    }
                  } @else {
                    <div class="presente-info">
                      <small class="quem"><mat-icon>badge</mat-icon>
                        {{ r.registrado_por_nome ?? '—' }}</small>
                      <button type="button" class="btn-undo" [disabled]="ocupando()"
                              (click)="desmarcar(r)" aria-label="Desmarcar presença">
                        <mat-icon>undo</mat-icon>Desfazer
                      </button>
                    </div>
                  }
                </div>
              </div>
            } @empty {
              <div class="q-vazio">Nenhuma reserva neste filtro.</div>
            }
          </div>
          <footer class="q-foot">
            <span>Exibindo {{ quadroFiltrado().length }} de {{ quadro().length }}
              {{ quadro().length === 1 ? 'reserva' : 'reservas' }}</span>
            <span class="q-nota-i"><mat-icon>info</mat-icon>
              Reservas e pessoas são contabilizadas separadamente.</span>
          </footer>
        }
      </section>
    </div>
  `,
  styles: `
    .page { background: transparent; border: 0; box-shadow: none;
      padding: 4px 6px 40px; max-width: 1440px; }
    .cafe { display: flex; flex-direction: column; gap: 16px; }

    .cafe-head { display: flex; align-items: flex-start; justify-content: space-between;
      gap: 16px; flex-wrap: wrap; }
    .eyebrow { font-size: 0.72rem; font-weight: 700; letter-spacing: 0.08em;
      text-transform: uppercase; color: #4b95ab; margin: 0 0 4px; }
    .titulo { margin: 0; font-family: 'Cormorant Garamond', Georgia, serif;
      font-size: 1.9rem; font-weight: 600; color: #054054; line-height: 1.1;
      display: flex; align-items: center; gap: 12px; }
    .sub { margin: 4px 0 0; font-size: 0.86rem; color: #7d97a1; }



    .dia-box { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
    .lbl { font-size: 0.72rem; font-weight: 600; color: #5d6d7e; }
    .dia-nav { display: flex; align-items: stretch; background: #fff;
      border: 1px solid #e3eaef; border-radius: 10px; overflow: hidden; }
    .nav-dia { width: 40px; border: 0; background: transparent; color: #5d6d7e;
      display: flex; align-items: center; justify-content: center; cursor: pointer; }
    .nav-dia:hover { background: #f4f8fa; color: #054054; }
    .dia-input { display: flex; align-items: center; gap: 8px; padding: 0 14px;
      border-left: 1px solid #e3eaef; border-right: 1px solid #e3eaef;
      color: #054054; }
    .dia-input app-date { width: 150px; }
    .dia-input ::ng-deep .dw-txt { border: 0; outline: none; box-shadow: none; font-size: 0.88rem;
      font-weight: 600; color: #33424c; background: transparent; height: 44px; }
    .hoje { border: 0; background: transparent; color: #4b95ab; font-size: 0.76rem;
      font-weight: 700; cursor: pointer; padding: 2px 4px; }
    .hoje:hover { color: #054054; }

    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 14px; }
    .stat { background: #fff; border: 1px solid #e3eaef; border-radius: 12px;
      padding: 16px 18px; display: flex; align-items: flex-start;
      justify-content: space-between; gap: 10px; }
    .stat-l { font-size: 0.8rem; font-weight: 600; color: #5d6d7e; }
    .stat p { margin: 6px 0 0; display: flex; align-items: baseline; gap: 7px; }
    .stat strong { font-family: 'Cormorant Garamond', Georgia, serif;
      font-size: 2rem; font-weight: 700; color: #054054; line-height: 1; }
    .stat small { font-size: 0.78rem; color: #8a99a4; }
    .stat-ico { width: 40px; height: 40px; border-radius: 10px;
      background: #eef4f6; display: flex; align-items: center;
      justify-content: center; flex-shrink: 0; }
    .stat-ico mat-icon { color: #054054; font-size: 20px; width: 20px; height: 20px; }

    .sec-head { display: flex; align-items: baseline; justify-content: space-between;
      gap: 10px; }
    .sec-head h3 { margin: 0; font-family: 'Cormorant Garamond', Georgia, serif;
      font-size: 1.5rem; font-weight: 600; color: #054054; }
    .sec-head span { font-size: 0.78rem; color: #7d97a1; }

    .quadro-card { background: #fff; border: 1px solid #e3eaef; border-radius: 12px;
      overflow: hidden; }
    .q-head { display: flex; align-items: flex-end; justify-content: space-between;
      gap: 16px; padding: 16px 18px; border-bottom: 1px solid #e3eaef;
      flex-wrap: wrap; }
    .q-busca { display: flex; flex-direction: column; gap: 6px;
      flex: 1; min-width: 240px; max-width: 520px; }
    .inp { border: 1px solid #d7e0e6; border-radius: 9px; padding: 11px 14px;
      font-size: 0.88rem; background: #fff; color: #33424c; }
    .inp:focus { outline: 2px solid #1a6f8a; border-color: #1a6f8a; }
    .seg { display: inline-flex; gap: 4px; }
    .seg-btn { border: 1px solid #d7e0e6; background: #fff; border-radius: 9px;
      padding: 9px 14px; font-size: 0.8rem; font-weight: 600; color: #5d6d7e;
      cursor: pointer; }
    .seg-btn b { font-weight: 800; margin-left: 2px; }
    .seg-btn.ativo { background: #054054; border-color: #054054; color: #fff; }

    .q-tab { display: flex; flex-direction: column; }
    .q-th { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(110px, .6fr)
      minmax(130px, .7fr) minmax(200px, 1fr); gap: 12px;
      padding: 11px 18px; background: #f4f8fa; font-size: 0.7rem;
      font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;
      color: #7d97a1; }
    .q-tr { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(110px, .6fr)
      minmax(130px, .7fr) minmax(200px, 1fr); gap: 12px;
      padding: 14px 18px; align-items: center;
      border-top: 1px solid #f2f7f9; }
    @media (max-width: 860px) {
      .q-th { display: none; }
      .q-tr { grid-template-columns: 1fr; gap: 10px; }
    }
    .q-hospede { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .q-tile { width: 58px; height: 58px; border-radius: 10px; flex-shrink: 0;
      background: #eef4f6; display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 1px; }
    .q-tile small { font-size: 0.62rem; color: #5d6d7e; }
    .q-tile b { font-size: 1.05rem; color: #054054;
      max-width: 52px; overflow: hidden; text-overflow: ellipsis;
      white-space: nowrap; }
    .q-nome { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .q-nome strong { font-size: 0.92rem; color: #33424c; }
    .q-nome small { font-size: 0.76rem; color: #8a99a4; }
    .q-pessoas { font-size: 0.86rem; color: #33424c; }
    .pill { display: inline-block; padding: 5px 12px; border-radius: 999px;
      font-size: 0.74rem; font-weight: 700; }
    .pill.aguarda { background: #fdf3e2; color: #92670b; }
    .pill.ok { background: #e3f3e6; color: #198754; }
    .q-acao { display: flex; flex-direction: column; align-items: flex-start;
      gap: 4px; }
    .btn-marcar { border: 0; border-radius: 9px; background: #054054;
      color: #fff; font-weight: 700; font-size: 0.85rem; padding: 12px 22px;
      cursor: pointer; }
    .btn-marcar:hover { background: #042f3d; }
    .q-nota { font-size: 0.72rem; color: #8fa3ab; }
    .presente-info { display: flex; align-items: center; gap: 12px; }
    .quem { display: inline-flex; align-items: center; gap: 5px;
      font-size: 0.76rem; color: #198754; }
    .quem mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .btn-undo { display: inline-flex; align-items: center; gap: 5px;
      border: 1px solid #cde6d2; border-radius: 8px; background: #fff;
      color: #198754; font-size: 0.78rem; font-weight: 700; padding: 7px 12px;
      cursor: pointer; }
    .btn-undo:hover { background: #e3f3e6; }
    .btn-undo mat-icon { font-size: 15px; width: 15px; height: 15px; }

    .stepper { display: flex; flex-direction: column; gap: 8px; }
    .stepper-linha { display: flex; align-items: center; gap: 12px; }
    .stepper-acoes { display: flex; gap: 8px; }
    .passo { width: 44px; height: 40px; border: 1px solid #d7e0e6;
      border-radius: 9px; background: #f4f8fa; display: flex;
      align-items: center; justify-content: center; cursor: pointer;
      color: #334155; }
    .passo:disabled { opacity: .35; cursor: default; }
    .passo mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .qtd { min-width: 40px; text-align: center; font-size: 1.4rem;
      font-weight: 800; font-variant-numeric: tabular-nums; color: #054054; }
    .confirmar { flex: 1; min-height: 40px; border: 0; border-radius: 9px;
      background: #198754; color: #fff; font-size: 0.82rem; font-weight: 700;
      display: inline-flex; align-items: center; justify-content: center;
      gap: 6px; cursor: pointer; padding: 0 12px; }
    .confirmar:disabled { opacity: .55; }
    .fechar { width: 40px; height: 40px; border: 1px solid #d7e0e6;
      border-radius: 9px; background: #fff; display: flex; align-items: center;
      justify-content: center; cursor: pointer; color: #64748b; }

    .q-vazio { display: flex; flex-direction: column; align-items: center;
      gap: 10px; color: #94a3b8; font-size: 0.9rem; padding: 46px 20px; }
    .q-vazio mat-icon { font-size: 40px; width: 40px; height: 40px; }
    .q-foot { display: flex; align-items: center; justify-content: space-between;
      gap: 10px; padding: 12px 18px; border-top: 1px solid #f2f7f9;
      font-size: 0.76rem; color: #8a99a4; flex-wrap: wrap; }
    .q-nota-i { display: inline-flex; align-items: center; gap: 5px; }
    .q-nota-i mat-icon { font-size: 14px; width: 14px; height: 14px; }
  `,
})
export class CafeComponent implements OnInit, OnDestroy {
  protected readonly rt = inject(Realtime);
  private readonly cafeApi = inject(CafeApi);
  private readonly notify = inject(Notify);

  readonly quadro = signal<CafeQuadroItem[]>([]);
  readonly carregando = signal(true);
  readonly dia = signal(this.isoHoje());
  readonly escolhendo = signal(0); // idreserva com stepper aberto
  readonly qtd = signal(1);
  readonly ocupando = signal(false);
  readonly busca = signal('');
  readonly filtro = signal<FiltroPresenca>('todas');

  readonly filtros: { v: FiltroPresenca; rotulo: string }[] = [
    { v: 'todas', rotulo: 'Todas' },
    { v: 'aguardando', rotulo: 'Aguardando' },
    { v: 'presentes', rotulo: 'Presentes' },
  ];

  readonly presentes = computed(() => this.quadro().filter((r) => r.presenca_id !== null).length);
  readonly aguardando = computed(() => this.quadro().filter((r) => r.presenca_id === null).length);
  readonly pessoasServidas = computed(
    () => this.quadro().reduce((s, r) => s + (r.presenca_quantidade ?? 0), 0),
  );

  readonly quadroFiltrado = computed(() => {
    const q = this.busca().trim().toLowerCase();
    const f = this.filtro();
    return this.quadro().filter((r) => {
      if (f === 'aguardando' && r.presenca_id !== null) return false;
      if (f === 'presentes' && r.presenca_id === null) return false;
      if (!q) return true;
      return (
        r.cliente_nome.toLowerCase().includes(q) ||
        (r.quarto_numero ?? '').toLowerCase().includes(q) ||
        r.acomodacao_nome.toLowerCase().includes(q)
      );
    });
  });

  contagemFiltro(f: FiltroPresenca): number {
    if (f === 'todas') return this.quadro().length;
    return f === 'aguardando' ? this.aguardando() : this.presentes();
  }

  constructor() {
    // realtime — qualquer presença (outra recepção/tablet) reflete aqui
    effect(() => {
      this.rt.delta('cafe_presenca');
      this.rt.delta('reserva');
      this.carregar(false);
    });
  }

  ngOnInit(): void {
    this.carregar(true);
  }

  ngOnDestroy(): void { /* nada a limpar */ }

  carregar(spinner: boolean): void {
    if (spinner) this.carregando.set(true);
    this.cafeApi.quadroCafe(this.dia()).subscribe({
      next: (q) => {
        this.quadro.set(q);
        this.carregando.set(false);
      },
      error: () => {
        this.carregando.set(false);
        this.notify.erro('Não foi possível carregar o quadro do café.');
      },
    });
  }

  abrir(r: CafeQuadroItem): void {
    this.qtd.set(r.quantidade_hospedes);
    this.escolhendo.set(r.idreserva);
  }

  passo(d: number, r: CafeQuadroItem): void {
    this.qtd.update((q) => Math.min(r.quantidade_hospedes, Math.max(1, q + d)));
  }

  confirmar(r: CafeQuadroItem): void {
    if (this.ocupando()) return;
    this.ocupando.set(true);
    this.cafeApi.registrarPresenca(r.idreserva, this.qtd(), this.dia()).subscribe({
      next: () => {
        this.ocupando.set(false);
        this.escolhendo.set(0);
        this.carregar(false);
      },
      error: (e: { error?: { erro?: { mensagem?: string } | string } }) => {
        this.ocupando.set(false);
        const m = e?.error?.erro;
        this.notify.erro(typeof m === 'string' ? m : m?.mensagem ?? 'Não foi possível registrar.');
      },
    });
  }

  desmarcar(r: CafeQuadroItem): void {
    if (this.ocupando() || r.presenca_id === null) return;
    this.ocupando.set(true);
    this.cafeApi.removerPresenca(r.presenca_id).subscribe({
      next: () => {
        this.ocupando.set(false);
        this.carregar(false);
      },
      error: () => {
        this.ocupando.set(false);
        this.notify.erro('Não foi possível desfazer.');
      },
    });
  }

  mudarDia(d: number): void {
    const dt = new Date(this.dia() + 'T12:00:00');
    dt.setDate(dt.getDate() + d);
    this.dia.set(dt.toISOString().slice(0, 10));
    this.carregar(true);
  }

  definirDia(v: string): void {
    if (v && v !== this.dia()) {
      this.dia.set(v);
      this.carregar(true);
    }
  }

  hoje(): void {
    this.dia.set(this.isoHoje());
    this.carregar(true);
  }

  ehHoje(): boolean {
    return this.dia() === this.isoHoje();
  }

  diaFormatado(): string {
    return new Date(this.dia() + 'T12:00:00').toLocaleDateString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
    });
  }

  hora(iso: string): string {
    return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  private isoHoje(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}
