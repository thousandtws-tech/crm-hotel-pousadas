// Café da manhã — quadro de presença por reserva/dia.
// Realtime: deltas de cafe_presenca recarregam o quadro (mesma infra do KDS).
// Touch-first: cards grandes, stepper de quantidade, sem modal.

import {
  Component, OnDestroy, OnInit, computed, effect, inject, signal,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { ApiService } from '../../core/services/api.service';
import { Realtime } from '../../core/services/realtime.service';
import { Notify } from '../../core/services/notify.service';
import { CafeQuadroItem } from '../../core/models/api.models';

@Component({
  selector: 'app-cafe',
  imports: [MatIconModule],
  template: `
    <div class="cafe">
      <header class="cafe-head">
        <div class="cafe-titulo">
          <mat-icon>free_breakfast</mat-icon>
          <h1>Café da Manhã</h1>
          <span class="live" [class.live-on]="rt.online()" role="status">
            {{ rt.online() ? 'AO VIVO' : 'reconectando…' }}
          </span>
        </div>
        <div class="dia-nav" role="group" aria-label="Navegar dia">
          <button type="button" class="nav-dia" (click)="mudarDia(-1)" aria-label="Dia anterior">
            <mat-icon>chevron_left</mat-icon>
          </button>
          <input type="date" class="dia-input" [value]="dia()"
                 (change)="definirDia($event)" aria-label="Data do quadro" />
          <button type="button" class="nav-dia" (click)="mudarDia(1)" aria-label="Próximo dia">
            <mat-icon>chevron_right</mat-icon>
          </button>
          @if (!ehHoje()) {
            <button type="button" class="chip chip-hoje" (click)="hoje()">Hoje</button>
          }
        </div>
      </header>

      <div class="cafe-stats">
        <div class="stat"><mat-icon>hotel</mat-icon>
          <div><strong>{{ quadro().length }}</strong><span>reservas na casa</span></div>
        </div>
        <div class="stat"><mat-icon>check_circle</mat-icon>
          <div><strong>{{ presentes() }}</strong><span>reservas presentes</span></div>
        </div>
        <div class="stat destaque"><mat-icon>groups</mat-icon>
          <div><strong>{{ pessoasServidas() }}</strong><span>pessoas servidas</span></div>
        </div>
      </div>

      @if (carregando()) {
        <div class="vazio"><mat-icon>hourglass_top</mat-icon>Carregando…</div>
      } @else if (quadro().length === 0) {
        <div class="vazio"><mat-icon>hotel</mat-icon>
          Nenhuma reserva em estadia em {{ diaFormatado() }}.
        </div>
      } @else {
        <div class="quadro">
          @for (r of quadro(); track r.idreserva) {
            <article class="card" [class.presente]="r.presenca_id !== null">
              <header class="card-head">
                <div class="card-quarto">
                  <mat-icon>{{ r.quarto_numero ? 'hotel' : 'bungalow' }}</mat-icon>
                  <strong>{{ r.quarto_numero ? 'Quarto ' + r.quarto_numero : r.acomodacao_nome }}</strong>
                </div>
                @if (r.presenca_id !== null) {
                  <span class="badge-ok"><mat-icon>restaurant</mat-icon>
                    {{ r.presenca_quantidade }}/{{ r.quantidade_hospedes }} · {{ hora(r.presenca_em!) }}
                  </span>
                } @else {
                  <span class="badge-aguarda">aguardando</span>
                }
              </header>
              <div class="card-meta">
                <span><mat-icon>person</mat-icon>{{ r.cliente_nome }}</span>
                <span><mat-icon>groups</mat-icon>{{ r.quantidade_hospedes }} hóspede(s)</span>
              </div>
              <div class="card-acao">
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
                                [disabled]="qtd() >= r.quantidade_hospedes" aria-label="Mais uma pessoa">
                          <mat-icon>add</mat-icon>
                        </button>
                      </div>
                      <div class="stepper-acoes">
                        <button type="button" class="confirmar" [disabled]="ocupando()"
                                (click)="confirmar(r)">
                          <mat-icon>check</mat-icon>Confirmar {{ qtd() }} pessoa(s)
                        </button>
                        <button type="button" class="fechar" (click)="escolhendo.set(0)"
                                aria-label="Cancelar"><mat-icon>close</mat-icon></button>
                      </div>
                    </div>
                  } @else {
                    <button type="button" class="btn-presente" (click)="abrir(r)">
                      <mat-icon>restaurant</mat-icon>Marcar presença
                    </button>
                  }
                } @else {
                  <div class="presente-info">
                    <span class="quem"><mat-icon>badge</mat-icon>{{ r.registrado_por_nome ?? '—' }}</span>
                    <button type="button" class="btn-undo" [disabled]="ocupando()"
                            (click)="desmarcar(r)" aria-label="Desmarcar presença">
                      <mat-icon>undo</mat-icon>Desfazer
                    </button>
                  </div>
                }
              </div>
            </article>
          }
        </div>
      }
    </div>
  `,
  styles: `
    .cafe { display: flex; flex-direction: column; gap: 14px; }
    .cafe-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .cafe-titulo { display: flex; align-items: center; gap: 10px; }
    .cafe-titulo mat-icon { font-size: 32px; width: 32px; height: 32px; color: #b45309; }
    .cafe-titulo h1 { margin: 0; font-size: 24px; }
    .live { font-size: 11px; font-weight: 800; letter-spacing: .08em; padding: 5px 10px;
      border-radius: 999px; background: #fee2e2; color: #b91c1c; }
    .live-on { background: #dcfce7; color: #15803d; animation: pulso 2s infinite; }
    @keyframes pulso { 50% { opacity: .65; } }
    .dia-nav { display: flex; align-items: center; gap: 6px; }
    .nav-dia { width: 44px; height: 44px; border: 1px solid #e2e8f0; border-radius: 10px;
      background: #fff; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #475569; }
    .dia-input { height: 44px; padding: 0 10px; border: 1px solid #e2e8f0; border-radius: 10px;
      font: inherit; font-size: 15px; background: #fff; }
    .chip { min-height: 40px; padding: 8px 16px; border-radius: 999px; border: 1px solid #e2e8f0;
      background: #fff; font-size: 14px; font-weight: 600; cursor: pointer; color: #475569; }
    .chip-hoje { background: #1e293b; color: #fff; border-color: #1e293b; }
    .cafe-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px,1fr)); gap: 10px; }
    .stat { display: flex; align-items: center; gap: 10px; background: #fff; border: 1px solid #e2e8f0;
      border-radius: 12px; padding: 12px 14px; }
    .stat mat-icon { color: #b45309; font-size: 26px; width: 26px; height: 26px; }
    .stat strong { display: block; font-size: 22px; }
    .stat span { font-size: 12px; color: #64748b; }
    .stat.destaque { background: #fffbeb; border-color: #fde68a; }
    .quadro { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px,1fr)); gap: 14px; }
    .card { background: #fff; border: 2px solid #e2e8f0; border-radius: 14px; overflow: hidden;
      box-shadow: 0 2px 8px rgba(15,23,42,.05); }
    .card.presente { border-color: #86efac; background: #f0fdf4; }
    .card-head { display: flex; align-items: center; justify-content: space-between;
      padding: 12px 14px; background: #1e293b; color: #fff; }
    .card.presente .card-head { background: #15803d; }
    .card-quarto { display: flex; align-items: center; gap: 8px; font-size: 17px; }
    .badge-ok { display: inline-flex; align-items: center; gap: 5px; font-size: 13px; font-weight: 700;
      background: rgba(255,255,255,.18); padding: 5px 10px; border-radius: 999px; }
    .badge-aguarda { font-size: 12px; font-weight: 700; color: #cbd5e1; text-transform: uppercase;
      letter-spacing: .05em; }
    .card-meta { display: flex; gap: 14px; padding: 10px 14px; font-size: 14px; color: #475569;
      border-bottom: 1px dashed #e2e8f0; flex-wrap: wrap; }
    .card-meta span { display: inline-flex; align-items: center; gap: 5px; }
    .card-meta mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .card-acao { padding: 12px 14px; }
    .btn-presente { width: 100%; min-height: 56px; display: flex; align-items: center; justify-content: center;
      gap: 10px; border: 0; border-radius: 12px; background: #d97706; color: #fff;
      font-size: 17px; font-weight: 800; cursor: pointer; touch-action: manipulation; }
    .stepper { display: flex; flex-direction: column; gap: 10px; }
    .stepper-linha { display: flex; align-items: center; justify-content: center; gap: 18px; }
    .stepper-acoes { display: flex; gap: 8px; }
    .passo { width: 64px; height: 56px; border: 1px solid #e2e8f0; border-radius: 12px; background: #f8fafc;
      display: flex; align-items: center; justify-content: center; cursor: pointer; color: #334155;
      transition: background .15s; }
    .passo:not(:disabled):active { background: #e2e8f0; }
    .passo:disabled { opacity: .35; cursor: default; }
    .passo mat-icon { font-size: 26px; width: 26px; height: 26px; }
    .qtd { min-width: 56px; text-align: center; font-size: 34px; font-weight: 800;
      font-variant-numeric: tabular-nums; color: #1e293b; }
    .confirmar { flex: 1; min-height: 52px; border: 0; border-radius: 12px; background: #16a34a; color: #fff;
      font-size: 15px; font-weight: 800; display: inline-flex; align-items: center; justify-content: center;
      gap: 6px; cursor: pointer; white-space: nowrap; padding: 0 12px; }
    .confirmar:disabled { opacity: .55; }
    .fechar { width: 52px; min-width: 52px; height: 52px; border: 1px solid #e2e8f0; border-radius: 12px; background: #fff;
      display: flex; align-items: center; justify-content: center; cursor: pointer; color: #64748b; }
    .presente-info { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .quem { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; color: #166534; }
    .btn-undo { min-height: 48px; padding: 0 16px; border: 1px solid #bbf7d0; border-radius: 12px;
      background: #fff; color: #15803d; font-size: 14px; font-weight: 700; display: inline-flex;
      align-items: center; gap: 6px; cursor: pointer; }
    .vazio { display: flex; flex-direction: column; align-items: center; gap: 10px;
      color: #94a3b8; font-size: 17px; padding: 50px 0; }
    .vazio mat-icon { font-size: 46px; width: 46px; height: 46px; }
    @media (max-width: 640px) {
      .quadro { grid-template-columns: 1fr; }
      .btn-presente { min-height: 60px; }
    }
  `,
})
export class CafeComponent implements OnInit, OnDestroy {
  protected readonly rt = inject(Realtime);
  private readonly api = inject(ApiService);
  private readonly notify = inject(Notify);

  readonly quadro = signal<CafeQuadroItem[]>([]);
  readonly carregando = signal(true);
  readonly dia = signal(this.isoHoje());
  readonly escolhendo = signal(0); // idreserva com stepper aberto
  readonly qtd = signal(1);
  readonly ocupando = signal(false);

  readonly presentes = computed(() => this.quadro().filter((r) => r.presenca_id !== null).length);
  readonly pessoasServidas = computed(
    () => this.quadro().reduce((s, r) => s + (r.presenca_quantidade ?? 0), 0),
  );

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
    this.api.quadroCafe(this.dia()).subscribe({
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
    this.api.registrarPresenca(r.idreserva, this.qtd(), this.dia()).subscribe({
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
    this.api.removerPresenca(r.presenca_id).subscribe({
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

  definirDia(ev: Event): void {
    const v = (ev.target as HTMLInputElement).value;
    if (v) {
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
