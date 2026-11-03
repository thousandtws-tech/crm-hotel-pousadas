// Cozinha (KDS) — painel de pedidos 100% realtime, otimizado para touch.
//
// Sincronização: sem polling. O Realtime (SSE) entrega deltas das triggers
// `trg_delta_pdv_item`/`trg_delta_pdv_comanda`; o effect() assina os
// contadores por tabela e recarrega a fila — o serviço já debounce 300ms.
// O relógio `agora` só re-renderiza o tempo decorrido (20s), não busca dados.

import {
  Component, OnDestroy, OnInit, computed, effect, inject, signal,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { ApiService } from '../../core/services/api.service';
import { Realtime } from '../../core/services/realtime.service';
import { Notify } from '../../core/services/notify.service';
import { FilaItemView, PdvItemStatus } from '../../core/models/api.models';

interface Ticket {
  idcomanda: number;
  destino: string;
  icone: string;
  cliente: string | null;
  garcom: string | null;
  abertoEm: string;
  itens: FilaItemView[];
  minutos: number;
}

type FiltroStatus = 'todos' | 'pendente' | 'em_preparo' | 'pronto';

@Component({
  selector: 'app-kds',
  imports: [MatIconModule],
  template: `
    <div class="kds" [class.kds-offline]="!rt.online()">
      <header class="kds-head">
        <div class="kds-titulo">
          <mat-icon>soup_kitchen</mat-icon>
          <h1>Cozinha</h1>
          <span class="live" [class.live-on]="rt.online()" role="status">
            {{ rt.online() ? 'AO VIVO' : 'reconectando…' }}
          </span>
        </div>
        <div class="kds-stats">
          <span class="stat stat-pend">{{ contagem('pendente') }} a fazer</span>
          <span class="stat stat-prep">{{ contagem('em_preparo') }} em preparo</span>
          <span class="stat stat-ready">{{ contagem('pronto') }} prontos</span>
          <button class="btn-som" type="button" [class.on]="somAtivo()"
                  (click)="alternarSom()" [attr.aria-pressed]="somAtivo()"
                  aria-label="Ativar aviso sonoro de novo pedido">
            <mat-icon>{{ somAtivo() ? 'volume_up' : 'volume_off' }}</mat-icon>
          </button>
        </div>
      </header>

      <div class="kds-filtros" role="group" aria-label="Filtros">
        @for (f of filtrosStatus; track f.v) {
          <button type="button" class="chip" [class.on]="filtroStatus() === f.v"
                  (click)="filtroStatus.set(f.v)">{{ f.rotulo }}</button>
        }
        <span class="sep"></span>
        <button type="button" class="chip" [class.on]="filtroCategoria() === 'todas'"
                (click)="filtroCategoria.set('todas')">Todas as categorias</button>
        @for (c of categorias(); track c) {
          <button type="button" class="chip" [class.on]="filtroCategoria() === c"
                  (click)="filtroCategoria.set(c)">{{ c }}</button>
        }
      </div>

      @if (carregando() && fila().length === 0) {
        <div class="vazio"><mat-icon>hourglass_top</mat-icon>Carregando pedidos…</div>
      } @else if (tickets().length === 0) {
        <div class="vazio"><mat-icon>done_all</mat-icon>Fila vazia — nenhum pedido aguardando.</div>
      } @else {
        <div class="board">
          @for (t of tickets(); track t.idcomanda) {
            <article class="ticket" [class.atraso]="t.minutos >= 15"
                     [class.alerta]="t.minutos >= 8 && t.minutos < 15">
              <header class="ticket-head">
                <div class="ticket-dest">
                  <mat-icon>{{ t.icone }}</mat-icon>
                  <strong>{{ t.destino }}</strong>
                </div>
                <span class="ticket-tempo" [attr.aria-label]="t.minutos + ' minutos em aberto'">
                  {{ t.minutos }}min
                </span>
              </header>
              <div class="ticket-meta">
                @if (t.garcom) { <span><mat-icon>room_service</mat-icon>{{ t.garcom }}</span> }
                @if (t.cliente) { <span><mat-icon>person</mat-icon>{{ t.cliente }}</span> }
              </div>
              <ul class="ticket-itens">
                @for (i of t.itens; track i.id) {
                  <li class="kitem" [class]="'st-' + i.status">
                    <div class="kitem-info">
                      <span class="kitem-qtd">{{ i.quantidade }}×</span>
                      <div class="kitem-nome">
                        <strong>{{ i.item_nome }}</strong>
                        @if (i.categoria_nome) { <small>{{ i.categoria_nome }}</small> }
                        <small class="kitem-min">{{ minutosItem(i.criado_em) }}min</small>
                      </div>
                    </div>
                    <div class="kitem-acoes">
                      @switch (i.status) {
                        @case ('pendente') {
                          <button type="button" class="acao acao-prep"
                                  [disabled]="ocupando().has(i.id)"
                                  (click)="preparar(i)">
                            <mat-icon>skillet</mat-icon>Preparar
                          </button>
                        }
                        @case ('em_preparo') {
                          <button type="button" class="acao acao-ready"
                                  [disabled]="ocupando().has(i.id)"
                                  (click)="pronto(i)">
                            <mat-icon>check_circle</mat-icon>Pronto
                          </button>
                          <button type="button" class="acao acao-voltar"
                                  [disabled]="ocupando().has(i.id)"
                                  (click)="retornar(i)" aria-label="Devolver à fila">
                            <mat-icon>undo</mat-icon>
                          </button>
                        }
                        @case ('pronto') {
                          <span class="aguarda"><mat-icon>room_service</mat-icon>aguarda entrega</span>
                          <button type="button" class="acao acao-voltar"
                                  [disabled]="ocupando().has(i.id)"
                                  (click)="retornar(i)" aria-label="Voltar ao preparo">
                            <mat-icon>undo</mat-icon>
                          </button>
                        }
                      }
                    </div>
                  </li>
                }
              </ul>
            </article>
          }
        </div>
      }
    </div>
  `,
  styles: `
    .kds { display: flex; flex-direction: column; gap: 14px; min-height: calc(100vh - 120px); }
    .kds-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .kds-titulo { display: flex; align-items: center; gap: 10px; }
    .kds-titulo mat-icon { font-size: 34px; width: 34px; height: 34px; color: var(--primaria, #5c6bc0); }
    .kds-titulo h1 { margin: 0; font-size: 26px; }
    .live {
      font-size: 11px; font-weight: 800; letter-spacing: .08em; padding: 5px 10px;
      border-radius: 999px; background: #fee2e2; color: #b91c1c;
    }
    .live-on { background: #dcfce7; color: #15803d; animation: pulso 2s infinite; }
    @keyframes pulso { 50% { opacity: .65; } }
    .kds-offline .board { opacity: .55; }
    .kds-stats { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .stat { font-size: 13px; font-weight: 700; padding: 7px 12px; border-radius: 8px; }
    .stat-pend { background: #fef3c7; color: #92400e; }
    .stat-prep { background: #dbeafe; color: #1d4ed8; }
    .stat-ready { background: #dcfce7; color: #15803d; }
    .btn-som {
      display: flex; align-items: center; justify-content: center; width: 44px; height: 44px;
      border: 1px solid #e2e8f0; border-radius: 10px; background: #fff; color: #94a3b8; cursor: pointer;
    }
    .btn-som.on { background: #ecfdf5; color: #15803d; border-color: #a7f3d0; }
    .kds-filtros { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .sep { width: 1px; height: 22px; background: #e2e8f0; margin: 0 4px; }
    .chip {
      min-height: 40px; padding: 8px 16px; border-radius: 999px; border: 1px solid #e2e8f0;
      background: #fff; font-size: 14px; font-weight: 600; cursor: pointer; color: #475569;
    }
    .chip.on { background: #1e293b; border-color: #1e293b; color: #fff; }
    .board {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 14px; align-items: start;
    }
    .ticket {
      background: #fff; border: 2px solid #e2e8f0; border-radius: 14px; overflow: hidden;
      box-shadow: 0 2px 8px rgba(15,23,42,.05);
    }
    .ticket.alerta { border-color: #f59e0b; }
    .ticket.atraso { border-color: #ef4444; box-shadow: 0 0 0 3px #fecaca; }
    .ticket-head {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 14px; background: #1e293b; color: #fff;
    }
    .ticket-dest { display: flex; align-items: center; gap: 8px; font-size: 18px; }
    .ticket-dest mat-icon { font-size: 24px; width: 24px; height: 24px; }
    .ticket-tempo { font-size: 16px; font-weight: 800; font-variant-numeric: tabular-nums; }
    .ticket.atraso .ticket-head { background: #b91c1c; }
    .ticket.alerta .ticket-head { background: #b45309; }
    .ticket-meta {
      display: flex; gap: 14px; padding: 8px 14px; font-size: 13px; color: #64748b;
      border-bottom: 1px dashed #e2e8f0; flex-wrap: wrap;
    }
    .ticket-meta span { display: inline-flex; align-items: center; gap: 4px; }
    .ticket-meta mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .ticket-itens { list-style: none; margin: 0; padding: 0; }
    .kitem { display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; border-bottom: 1px solid #f1f5f9; }
    .kitem:last-child { border-bottom: 0; }
    .kitem-info { display: flex; align-items: flex-start; gap: 10px; }
    .kitem-qtd { font-size: 22px; font-weight: 800; color: #1e293b; min-width: 44px; }
    .kitem-nome { display: flex; flex-direction: column; gap: 2px; font-size: 17px; }
    .kitem-nome small { color: #94a3b8; font-size: 12px; }
    .kitem-min { font-weight: 700; color: #64748b !important; }
    .kitem-acoes { display: flex; gap: 8px; }
    .acao {
      flex: 1; min-height: 52px; display: inline-flex; align-items: center; justify-content: center;
      gap: 8px; border: 0; border-radius: 12px; font-size: 17px; font-weight: 800; cursor: pointer;
      touch-action: manipulation;
    }
    .acao:disabled { opacity: .5; cursor: wait; }
    .acao-prep { background: #2563eb; color: #fff; }
    .acao-ready { background: #16a34a; color: #fff; }
    .acao-voltar { flex: 0 0 52px; background: #f1f5f9; color: #64748b; }
    .aguarda {
      flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      min-height: 52px; border-radius: 12px; background: #dcfce7; color: #15803d;
      font-size: 15px; font-weight: 700;
    }
    .st-pronto .kitem-qtd, .st-pronto .kitem-nome strong { color: #15803d; }
    .vazio {
      flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 10px; color: #94a3b8; font-size: 18px; padding: 60px 0;
    }
    .vazio mat-icon { font-size: 52px; width: 52px; height: 52px; }
    @media (max-width: 640px) {
      .board { grid-template-columns: 1fr; }
      .kds-titulo h1 { font-size: 21px; }
      .acao { min-height: 56px; }
    }
  `,
})
export class KdsComponent implements OnInit, OnDestroy {
  protected readonly rt = inject(Realtime);
  private readonly api = inject(ApiService);
  private readonly notify = inject(Notify);

  readonly fila = signal<FilaItemView[]>([]);
  readonly carregando = signal(true);
  readonly agora = signal(Date.now());
  readonly filtroStatus = signal<FiltroStatus>('todos');
  readonly filtroCategoria = signal('todas');
  readonly somAtivo = signal(false);
  readonly ocupando = signal<ReadonlySet<number>>(new Set());

  readonly filtrosStatus: { v: FiltroStatus; rotulo: string }[] = [
    { v: 'todos', rotulo: 'Todos' },
    { v: 'pendente', rotulo: 'A fazer' },
    { v: 'em_preparo', rotulo: 'Em preparo' },
    { v: 'pronto', rotulo: 'Prontos' },
  ];

  private audio: AudioContext | null = null;
  private pendentesAntes = 0;
  private relogio: ReturnType<typeof setInterval> | null = null;

  readonly categorias = computed(() => {
    const set = new Set<string>();
    for (const i of this.fila()) if (i.categoria_nome) set.add(i.categoria_nome);
    return [...set].sort();
  });

  readonly tickets = computed<Ticket[]>(() => {
    const fs = this.filtroStatus();
    const fc = this.filtroCategoria();
    const mapa = new Map<number, Ticket>();
    for (const i of this.fila()) {
      if (fs !== 'todos' && i.status !== fs) continue;
      if (fc !== 'todas' && i.categoria_nome !== fc) continue;
      let t = mapa.get(i.idcomanda);
      if (!t) {
        t = {
          idcomanda: i.idcomanda,
          destino: this.destino(i),
          icone: this.icone(i.comanda_tipo),
          cliente: i.cliente_nome,
          garcom: i.garcom_nome,
          abertoEm: i.comanda_aberto_em,
          itens: [],
          minutos: 0,
        };
        mapa.set(i.idcomanda, t);
      }
      t.itens.push(i);
      t.minutos = Math.max(t.minutos, this.minutosItem(i.criado_em));
    }
    return [...mapa.values()].sort((a, b) => b.minutos - a.minutos);
  });

  constructor() {
    // 100% realtime — deltas das triggers recarregam a fila (debounce no service)
    effect(() => {
      this.rt.delta('pdv_comanda_item');
      this.rt.delta('pdv_comanda');
      this.carregar(false);
    });
  }

  ngOnInit(): void {
    this.carregar(true);
    this.relogio = setInterval(() => this.agora.set(Date.now()), 20_000);
  }

  ngOnDestroy(): void {
    if (this.relogio) clearInterval(this.relogio);
    this.audio?.close().catch(() => undefined);
  }

  carregar(mostrarSpinner: boolean): void {
    if (mostrarSpinner) this.carregando.set(true);
    this.api.filaCozinha().subscribe({
      next: (f) => {
        const pendentes = f.filter((i) => i.status === 'pendente').length;
        if (this.somAtivo() && pendentes > this.pendentesAntes) this.bip();
        this.pendentesAntes = pendentes;
        this.fila.set(f);
        this.carregando.set(false);
      },
      error: () => {
        this.carregando.set(false);
        this.notify.erro('Não foi possível carregar a fila da cozinha.');
      },
    });
  }

  contagem(status: PdvItemStatus): number {
    return this.fila().filter((i) => i.status === status).length;
  }

  minutosItem(iso: string): number {
    return Math.max(0, Math.floor((this.agora() - new Date(iso).getTime()) / 60_000));
  }

  async preparar(i: FilaItemView): Promise<void> {
    await this.transicao(i, () => this.api.prepararItem(i.idcomanda, i.id));
  }
  async pronto(i: FilaItemView): Promise<void> {
    await this.transicao(i, () => this.api.prontoItem(i.idcomanda, i.id));
  }
  async retornar(i: FilaItemView): Promise<void> {
    await this.transicao(i, () => this.api.retornarItem(i.idcomanda, i.id));
  }

  alternarSom(): void {
    const on = !this.somAtivo();
    this.somAtivo.set(on);
    if (on && !this.audio) {
      this.audio = new AudioContext();
      void this.audio.resume();
    }
  }

  /** Update otimista + fallback para a fila real em caso de erro/conflito. */
  private async transicao(
    item: FilaItemView,
    req: () => ReturnType<ApiService['prepararItem']>,
  ): Promise<void> {
    if (this.ocupando().has(item.id)) return;
    this.ocupando.update((s) => new Set(s).add(item.id));
    req().subscribe({
      next: (novo) => {
        this.fila.update((f) => f.map((x) => (x.id === novo.id ? { ...x, status: novo.status } : x)));
        this.ocupando.update((s) => { const n = new Set(s); n.delete(item.id); return n; });
      },
      error: (e: { error?: { erro?: string } }) => {
        this.ocupando.update((s) => { const n = new Set(s); n.delete(item.id); return n; });
        this.notify.erro(e?.error?.erro ?? 'Ação recusada — o item mudou de estado.');
        this.carregar(false);
      },
    });
  }

  private destino(i: FilaItemView): string {
    if (i.mesa_numero) return `Mesa ${i.mesa_numero}`;
    if (i.quarto_numero) return `Quarto ${i.quarto_numero}`;
    return i.rotulo ? `Balcão · ${i.rotulo}` : 'Balcão';
  }

  private icone(tipo: FilaItemView['comanda_tipo']): string {
    return tipo === 'mesa' ? 'table_restaurant' : tipo === 'quarto' ? 'hotel' : 'storefront';
  }

  private bip(): void {
    if (!this.audio) return;
    const t = this.audio.currentTime;
    for (const [ini, freq] of [[0, 880], [0.16, 1320]] as const) {
      const osc = this.audio.createOscillator();
      const gain = this.audio.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.18, t + ini);
      gain.gain.exponentialRampToValueAtTime(0.001, t + ini + 0.14);
      osc.connect(gain).connect(this.audio.destination);
      osc.start(t + ini);
      osc.stop(t + ini + 0.15);
    }
  }
}
