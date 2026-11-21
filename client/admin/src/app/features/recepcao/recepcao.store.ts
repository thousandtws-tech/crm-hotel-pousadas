// Lógica e estado de recepcao — separada da camada de UI (recepcao.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { OnInit, computed, effect, inject, signal, Directive } from '@angular/core';
import { Router } from '@angular/router';
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
  private readonly router = inject(Router);
  protected readonly rt = inject(RealtimeService);

  protected readonly hoje = new Date();
  protected readonly chegadas = signal<ReservaResumo[]>([]);
  protected readonly saidas = signal<ReservaResumo[]>([]);
  protected readonly naCasa = signal<ReservaResumo[]>([]);
  protected readonly mapa = signal<MapaQuarto[]>([]);
  protected readonly filtroMapa = signal<'todos' | 'livre' | 'ocupado' | 'atencao'>('todos');
  protected readonly aguardando = signal<number | null>(null);
  protected readonly carregando = signal(true);
  protected readonly skel = [1, 2, 3];
  protected readonly skelMapa = Array.from({ length: 18 }, (_, i) => i);

  /** Mapa idreserva → resumo para exibir hóspede e datas direto no card do quarto. */
  protected readonly reservaPorId = computed(() => {
    const m = new Map<number, ReservaResumo>();
    for (const r of this.chegadas()) m.set(r.id, r);
    for (const r of this.naCasa()) m.set(r.id, r);
    return m;
  });

  protected readonly livresCount = computed(
    () => this.mapa().filter((q) => !q.bloqueado && !q.status_hoje).length,
  );

  protected readonly andares = computed(() => {
    const f = this.filtroMapa();
    const porAndar = new Map<number, MapaQuarto[]>();
    for (const q of this.mapa()) {
      if (f === 'livre' && (q.bloqueado || !!q.status_hoje)) continue;
      if (f === 'ocupado' && q.status_hoje !== 'i' && q.status_hoje !== 'p') continue;
      if (f === 'atencao' && q.limpeza_pendente === 0 && q.manut_aberta === 0 && !q.bloqueado) {
        continue;
      }
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
    if (q.status_hoje === 'p') return 'Chega hoje';
    return 'Livre';
  }

  reservaDoQuarto(q: MapaQuarto): ReservaResumo | null {
    return q.idreserva_hoje ? (this.reservaPorId().get(q.idreserva_hoje) ?? null) : null;
  }

  cliqueQuarto(q: MapaQuarto): void {
    if (q.idreserva_hoje) {
      void this.router.navigate(['/reservas', q.idreserva_hoje]);
      return;
    }
    if (q.bloqueado) return;
    const ini = this.isoLocal(this.hoje);
    const amanha = new Date(this.hoje);
    amanha.setDate(amanha.getDate() + 1);
    this.abrirNovaReserva({
      idacomodacao: q.id,
      entrada: ini,
      saida: this.isoLocal(amanha),
    });
  }

  abrirNovaReserva(seed: { idacomodacao: number; entrada: string; saida: string }): void {
    void this.router.navigate(['/reservas'], {
      queryParams: {
        nova: '1',
        acomodacao: seed.idacomodacao,
        entrada: seed.entrada,
        saida: seed.saida,
      },
    });
  }

  private isoLocal(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
