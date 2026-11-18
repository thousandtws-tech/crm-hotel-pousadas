// Lógica e estado de recepcao — separada da camada de UI (recepcao.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { OnInit, computed, effect, inject, signal, Directive } from '@angular/core';
import { ReservasApi } from '@core/api/reservas.api';
import { MapaQuarto, ReservaResumo } from '@core/models/reservas.models';
import { Notify } from '@core/services/notify.service';
import { Realtime } from '@core/services/realtime.service';

const DIA_MS = 86_400_000;

/** Recepção — front desk operacional: fluxo do dia + mapa de quartos em tempo real. */
@Directive()
export abstract class RecepcaoStore implements OnInit {
  private readonly reservasApi = inject(ReservasApi);
  private readonly notify = inject(Notify);
  protected readonly rt = inject(Realtime);

  protected readonly hoje = new Date();
  protected readonly chegadas = signal<ReservaResumo[]>([]);
  protected readonly saidas = signal<ReservaResumo[]>([]);
  protected readonly naCasa = signal<ReservaResumo[]>([]);
  protected readonly mapa = signal<MapaQuarto[]>([]);
  protected readonly aguardando = signal<number | null>(null);
  protected readonly carregando = signal(true);
  protected readonly skel = [1, 2, 3];
  protected readonly skelMapa = Array.from({ length: 18 }, (_, i) => i);

  private pendentes = 0;

  protected readonly andares = computed(() => {
    const porAndar = new Map<number, MapaQuarto[]>();
    for (const q of this.mapa()) {
      const l = porAndar.get(q.andar) ?? [];
      l.push(q);
      porAndar.set(q.andar, l);
    }
    return [...porAndar.entries()]
      .sort(([a], [b]) => b - a)
      .map(([andar, quartos]) => ({ andar, quartos }));
  });

  protected readonly ocupados = computed(
    () => this.mapa().filter((q) => q.status_hoje === 'i').length,
  );
  protected readonly ocupacao = computed(() => {
    const total = this.mapa().length;
    return total ? Math.round((this.ocupados() / total) * 100) : 0;
  });
  protected readonly limpezaPend = computed(
    () => this.mapa().filter((q) => q.limpeza_pendente > 0).length,
  );
  protected readonly manutAberta = computed(
    () => this.mapa().filter((q) => q.manut_aberta > 0).length,
  );
  protected readonly emAtencao = computed(() => this.limpezaPend() + this.manutAberta());

  constructor() {
    let ultimo = -1;
    effect(() => {
      const v = this.rt.mudanca('reserva', 'consumo', 'acomodacao', 'bloqueio');
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

  carregar(): void {
    this.pendentes = 3;
    this.carregando.set(true);
    const done = () => {
      if (--this.pendentes === 0) this.carregando.set(false);
    };
    const hoje = this.hoje.toISOString().slice(0, 10);
    this.reservasApi
      .listarReservas({ inicio: hoje, fim: hoje, status: 'p', porPagina: 50 })
      .subscribe({
        next: (p) => this.chegadas.set(p.items),
        error: (e) => this.notify.erro(e),
        complete: done,
      });
    this.reservasApi
      .listarReservas({ inicio: hoje, fim: hoje, status: 'i', porPagina: 100 })
      .subscribe({
        next: (p) => {
          this.naCasa.set(p.items);
          this.saidas.set(p.items.filter((r) => r.saidaprevista === hoje));
        },
        error: () => undefined,
        complete: done,
      });
    this.reservasApi.mapaQuartos().subscribe({
      next: (m) => this.mapa.set(m),
      error: () => undefined,
      complete: done,
    });
  }

  checkin(r: ReservaResumo): void {
    this.aguardando.set(r.id);
    this.reservasApi.checkin(r.id, null, null).subscribe({
      next: () => {
        this.aguardando.set(null);
        this.notify.ok(`Check-in de ${r.cliente_nome} realizado.`);
        this.carregar();
      },
      error: (e) => {
        this.aguardando.set(null);
        this.notify.erro(e);
      },
    });
  }

  statusQuarto(q: MapaQuarto): string {
    if (q.bloqueado) return 'qt-bloq';
    if (q.status_hoje === 'i') return 'qt-ocup';
    if (q.status_hoje === 'p') return 'qt-pend';
    return 'qt-livre';
  }

  rotuloQuarto(q: MapaQuarto): string {
    if (q.bloqueado) return 'Bloqueado';
    if (q.status_hoje === 'i') return 'Ocupado';
    if (q.status_hoje === 'p') return 'Chegada prevista hoje';
    return 'Livre';
  }

  iniciais(nome: string): string {
    const p = nome.trim().split(/\s+/).filter(Boolean);
    return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase() || '?';
  }

  diarias(r: ReservaResumo): number {
    const ini = new Date(r.entradaprevista + 'T12:00:00');
    const fim = new Date(r.saidaprevista + 'T12:00:00');
    return Math.max(1, Math.round((fim.getTime() - ini.getTime()) / DIA_MS));
  }
}
