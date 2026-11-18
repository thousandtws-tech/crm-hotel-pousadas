// Lógica e estado de kds — separada da camada de UI (kds.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { OnDestroy, OnInit, computed, effect, inject, signal, Directive } from '@angular/core';
import { PdvApi } from '@core/api/pdv.api';
import { Realtime } from '../../core/services/realtime.service';
import { Notify } from '../../core/services/notify.service';
import { FilaItemView, PdvItemStatus } from '@core/models/pdv.models';

interface Ticket {
  idcomanda: number;
  destino: string;
  icone: string;
  cliente: string | null;
  garcom: string | null;
  recebido: string;
  itens: FilaItemView[];
  minutos: number;
}

interface Coluna {
  status: PdvItemStatus;
  rotulo: string;
  ajuda: string;
  icone: string;
  tickets: Ticket[];
}

type FiltroStatus = 'todos' | PdvItemStatus;

@Directive()
export abstract class KdsStore implements OnInit, OnDestroy {
  protected readonly rt = inject(Realtime);
  private readonly pdvApi = inject(PdvApi);
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

  /** Etapas do kanban — mesma ordem do quadro. */
  private readonly etapas: {
    status: PdvItemStatus;
    rotulo: string;
    ajuda: string;
    icone: string;
  }[] = [
    {
      status: 'pendente',
      rotulo: 'A fazer',
      ajuda: 'Comece pelos pedidos mais antigos',
      icone: 'assignment',
    },
    {
      status: 'em_preparo',
      rotulo: 'Em preparo',
      ajuda: 'Marque quando estiver pronto',
      icone: 'soup_kitchen',
    },
    {
      status: 'pronto',
      rotulo: 'Prontos',
      ajuda: 'Aguardando retirada · não entregues',
      icone: 'done_all',
    },
  ];

  /** Tickets de uma etapa: comanda agrupada, só com os itens daquela etapa. */
  private ticketsDe(status: PdvItemStatus): Ticket[] {
    const fc = this.filtroCategoria();
    const mapa = new Map<number, Ticket>();
    for (const i of this.fila()) {
      if (i.status !== status) continue;
      if (fc !== 'todas' && i.categoria_nome !== fc) continue;
      let t = mapa.get(i.idcomanda);
      if (!t) {
        t = {
          idcomanda: i.idcomanda,
          destino: this.destino(i),
          icone: this.icone(i.comanda_tipo),
          cliente: i.cliente_nome,
          garcom: i.garcom_nome,
          recebido: i.criado_em,
          itens: [],
          minutos: 0,
        };
        mapa.set(i.idcomanda, t);
      }
      t.itens.push(i);
      if (i.criado_em < t.recebido) t.recebido = i.criado_em;
      t.minutos = Math.max(t.minutos, this.minutosItem(i.criado_em));
    }
    // mais antigos primeiro — mesmo critério do rodapé da prancha
    return [...mapa.values()].sort((a, b) => b.minutos - a.minutos);
  }

  colunaDe(status: PdvItemStatus): Coluna {
    const meta = this.etapas.find((e) => e.status === status)!;
    return { ...meta, tickets: this.ticketsDe(status) };
  }

  readonly colunasVisiveis = computed<Coluna[]>(() => {
    const f = this.filtroStatus();
    return this.etapas
      .filter((e) => f === 'todos' || e.status === f)
      .map((e) => ({ ...e, tickets: this.ticketsDe(e.status) }));
  });

  readonly ticketsTotal = computed(() =>
    this.colunasVisiveis().reduce((s, c) => s + c.tickets.length, 0),
  );
  readonly itensTotal = computed(() =>
    this.colunasVisiveis().reduce(
      (s, c) => s + c.tickets.reduce((x, t) => x + t.itens.length, 0),
      0,
    ),
  );

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
    this.pdvApi.filaCozinha().subscribe({
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

  minutosItem(iso: string): number {
    return Math.max(0, Math.floor((this.agora() - new Date(iso).getTime()) / 60_000));
  }

  ocupandoTicket(t: Ticket): boolean {
    return t.itens.some((i) => this.ocupando().has(i.id));
  }

  /** Ação do card aplica a transição a todos os itens exibidos daquela etapa. */
  acaoTicket(t: Ticket, acao: 'preparar' | 'pronto' | 'entregar'): void {
    for (const i of t.itens) {
      if (acao === 'preparar')
        void this.transicao(i, () => this.pdvApi.prepararItem(i.idcomanda, i.id));
      else if (acao === 'pronto')
        void this.transicao(i, () => this.pdvApi.prontoItem(i.idcomanda, i.id));
      else void this.transicao(i, () => this.pdvApi.entregarItem(i.idcomanda, i.id));
    }
  }

  async retornar(i: FilaItemView): Promise<void> {
    await this.transicao(i, () => this.pdvApi.retornarItem(i.idcomanda, i.id));
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
    req: () => ReturnType<PdvApi['prepararItem']>,
  ): Promise<void> {
    if (this.ocupando().has(item.id)) return;
    this.ocupando.update((s) => new Set(s).add(item.id));
    req().subscribe({
      next: (novo) => {
        this.fila.update((f) =>
          f.map((x) => (x.id === novo.id ? { ...x, status: novo.status } : x)),
        );
        this.ocupando.update((s) => {
          const n = new Set(s);
          n.delete(item.id);
          return n;
        });
      },
      error: (e: { error?: { erro?: { mensagem?: string } } }) => {
        this.ocupando.update((s) => {
          const n = new Set(s);
          n.delete(item.id);
          return n;
        });
        this.notify.erro(e?.error?.erro?.mensagem ?? 'Ação recusada — o item mudou de estado.');
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
    return tipo === 'mesa' ? 'table_restaurant' : tipo === 'quarto' ? 'king_bed' : 'storefront';
  }

  private bip(): void {
    if (!this.audio) return;
    const t = this.audio.currentTime;
    for (const [ini, freq] of [
      [0, 880],
      [0.16, 1320],
    ] as const) {
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
