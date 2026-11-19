// Lógica e estado de recepcao — separada da camada de UI (recepcao.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { OnInit, computed, effect, inject, signal, Directive } from '@angular/core';
import { ReservasApi } from '@core/api/reservas.api';
import { MapaQuarto, ReservaResumo } from '@core/models/reservas.models';
import { NotifyService } from '@core/services/notify.service';
import { RealtimeService } from '@core/services/realtime.service';

const DIA_MS = 86_400_000;

/** Recepção — front desk operacional: fluxo do dia + mapa de quartos em tempo real. */
@Directive()
export abstract class RecepcaoStore implements OnInit {
  private readonly reservasApi = inject(ReservasApi);
  private readonly notify = inject(NotifyService);
  protected readonly rt = inject(RealtimeService);

  protected readonly hoje = new Date();
  protected readonly chegadas = signal<ReservaResumo[]>([]);
  protected readonly saidas = signal<ReservaResumo[]>([]);
  protected readonly naCasa = signal<ReservaResumo[]>([]);
  protected readonly mapa = signal<MapaQuarto[]>([]);
  protected readonly aguardando = signal<number | null>(null);
  protected readonly carregando = signal(true);
  protected readonly skel = [1, 2, 3];
  protected readonly skelMapa = Array.from({ length: 18 }, (_, i) => i);

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
    this.carregando.set(true);
    // Data local (não UTC): toISOString vira o dia às 21h no horário de
    // Brasília — a recepção via chegadas do dia errado no turno da noite.
    const d = this.hoje;
    const hoje = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    // 1 request consolidada — backend resolve as 3 leituras em paralelo.
    this.reservasApi.painelRecepcao(hoje).subscribe({
      next: (p) => {
        this.chegadas.set(p.chegadas);
        this.naCasa.set(p.na_casa);
        this.saidas.set(p.na_casa.filter((r) => r.saidaprevista === hoje));
        this.mapa.set(p.mapa);
        this.carregando.set(false);
      },
      error: (e) => {
        this.notify.erro(e);
        this.carregando.set(false);
      },
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
