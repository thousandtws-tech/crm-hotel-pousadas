// Lógica e estado do tape chart reutilizável — separada da UI (tape-chart.component.ts).
import { Directive, OnInit, computed, effect, inject, output, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AcomodacoesApi } from '@core/api/acomodacoes.api';
import { ReservasApi } from '@core/api/reservas.api';
import { Acomodacao } from '@core/models/catalogo.models';
import { StatusReserva } from '@core/models/comum.models';
import { ReservaResumo } from '@core/models/reservas.models';
import { NotifyService } from '@core/services/notify.service';
import { RealtimeService } from '@core/services/realtime.service';

const DIA_MS = 86_400_000;
const JANELA_DIAS = 14;
const COL_W = 92;
const ROW_H = 46;

/** Tape chart de ocupação (14 dias × acomodações) com drag-to-move e walk-in. */
@Directive()
export abstract class TapeChartStore implements OnInit {
  private readonly acomodacoesApi = inject(AcomodacoesApi);
  private readonly reservasApi = inject(ReservasApi);
  private readonly notify = inject(NotifyService);
  private readonly router = inject(Router);
  protected readonly rt = inject(RealtimeService);

  /** Emitido ao clicar numa célula vazia (walk-in). */
  abstract readonly novaReserva: ReturnType<typeof output<{
    idacomodacao: number;
    entrada: string;
    saida: string;
  }>>;

  protected readonly janelaInicio = signal<Date>(this.hoje());
  protected readonly dias = computed(() =>
    Array.from({ length: JANELA_DIAS }, (_, i) => this.addDias(this.janelaInicio(), i)),
  );
  protected readonly eventos = signal<ReservaResumo[]>([]);
  protected readonly acomodacoes = signal<Acomodacao[]>([]);
  protected readonly carregando = signal(true);
  protected readonly hojeIso = this.isoLocal(new Date());

  private readonly STATUS: Record<StatusReserva, { rotulo: string }> = {
    p: { rotulo: 'Pendente' },
    i: { rotulo: 'Hospedado' },
    f: { rotulo: 'Finalizado' },
    c: { rotulo: 'Cancelada' },
  };

  protected readonly eventosPorAcom = computed(() => {
    const m = new Map<number, ReservaResumo[]>();
    for (const e of this.eventos()) {
      const l = m.get(e.idacomodacao) ?? [];
      l.push(e);
      m.set(e.idacomodacao, l);
    }
    return m;
  });

  protected readonly arrastando = signal<{ r: ReservaResumo; dx: number; dy: number } | null>(
    null,
  );
  protected readonly arrastePeriodo = computed(() => {
    const a = this.arrastando();
    if (!a) return null;
    const d = Math.round(a.dx / COL_W);
    return {
      entrada: this.addDias(this.parseDia(a.r.entradaprevista), d),
      saida: this.addDias(this.parseDia(a.r.saidaprevista), d),
    };
  });

  private drag: { r: ReservaResumo; x0: number; y0: number } | null = null;
  private suprimirClique = false;

  constructor() {
    let ultimo = -1;
    effect(() => {
      const v = this.rt.mudanca('reserva', 'acomodacao', 'bloqueio');
      if (ultimo < 0) {
        ultimo = v;
        return;
      }
      if (v !== ultimo) {
        ultimo = v;
        this.carregarEventos();
      }
    });
  }

  ngOnInit(): void {
    this.acomodacoesApi.listarAcomodacoes(1, 200, true).subscribe({
      next: (p) => this.acomodacoes.set(p.items),
      error: () => undefined,
    });
    this.carregarEventos();
  }

  nav(d: number): void {
    this.janelaInicio.update((x) => this.addDias(x, d));
    this.carregarEventos();
  }

  irHoje(): void {
    this.janelaInicio.set(this.hoje());
    this.carregarEventos();
  }

  carregarEventos(): void {
    this.carregando.set(true);
    const ini = this.isoLocal(this.dias()[0]);
    const fim = this.isoLocal(this.addDias(this.dias()[0], JANELA_DIAS));
    this.reservasApi.eventosReserva(ini, fim).subscribe({
      next: (ev) => {
        this.eventos.set(ev);
        this.carregando.set(false);
      },
      error: (e) => {
        this.carregando.set(false);
        this.notify.erro(e);
      },
    });
  }

  eventosDe(idacomodacao: number): ReservaResumo[] {
    return this.eventosPorAcom().get(idacomodacao) ?? [];
  }

  barGeo(r: ReservaResumo): { l: number; w: number } | null {
    const ini = this.parseDia(r.entradaprevista);
    const fim = this.parseDia(r.saidaprevista);
    const jIni = this.dias()[0];
    const jFim = this.addDias(jIni, JANELA_DIAS);
    const s = ini < jIni ? jIni : ini;
    const e = fim > jFim ? jFim : fim;
    if (e <= s) return null;
    const l = ((s.getTime() - jIni.getTime()) / DIA_MS) * COL_W;
    const w = ((e.getTime() - s.getTime()) / DIA_MS) * COL_W - 3;
    return { l, w: Math.max(w, 18) };
  }

  iniciarArraste(r: ReservaResumo, ev: MouseEvent): void {
    if (r.status !== 'p' || ev.button !== 0) return;
    ev.preventDefault();
    this.drag = { r, x0: ev.clientX, y0: ev.clientY };
    const mover = (e: MouseEvent) =>
      this.arrastando.set({
        r,
        dx: e.clientX - this.drag!.x0,
        dy: e.clientY - this.drag!.y0,
      });
    const soltar = (e: MouseEvent) => {
      window.removeEventListener('mousemove', mover);
      window.removeEventListener('mouseup', soltar);
      const dx = e.clientX - this.drag!.x0;
      const dy = e.clientY - this.drag!.y0;
      this.drag = null;
      this.arrastando.set(null);
      const dDias = Math.round(dx / COL_W);
      const dRows = Math.round(dy / ROW_H);
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      this.suprimirClique = true;
      setTimeout(() => (this.suprimirClique = false), 0);
      if (dDias === 0 && dRows === 0) return;
      const lista = this.acomodacoes();
      const idx = lista.findIndex((a) => a.id === r.idacomodacao);
      const alvo = lista[idx + dRows];
      if (!alvo) return;
      const novaEnt = this.isoLocal(this.addDias(this.parseDia(r.entradaprevista), dDias));
      const novaSai = this.isoLocal(this.addDias(this.parseDia(r.saidaprevista), dDias));
      this.reservasApi
        .remanejar(r.id, {
          idacomodacao: alvo.id,
          entradaprevista: novaEnt,
          saidaprevista: novaSai,
        })
        .subscribe({
        next: () => {
          this.notify.ok(`Reserva de ${r.cliente_nome} remanejada para ${alvo.nome}.`);
          this.carregarEventos();
        },
        error: (err) => {
          this.notify.erro(err);
          this.carregarEventos();
        },
      });
    };
    window.addEventListener('mousemove', mover);
    window.addEventListener('mouseup', soltar);
  }

  cliqueReserva(r: ReservaResumo): void {
    if (this.suprimirClique) return;
    void this.router.navigate(['/reservas', r.id]);
  }

  novaReservaEm(a: Acomodacao, d: Date): void {
    this.novaReserva.emit({
      idacomodacao: a.id,
      entrada: this.isoLocal(d),
      saida: this.isoLocal(this.addDias(d, 1)),
    });
  }

  stRotulo(s: StatusReserva): string {
    return this.STATUS[s]?.rotulo ?? s;
  }

  nomeCompleto(nome: string): string {
    return nome
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => p[0].toUpperCase() + p.slice(1).toLowerCase())
      .join(' ');
  }

  parseDia(s: string): Date {
    const [y, m, d] = s.slice(0, 10).split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  isoLocal(d: Date): string {
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${dia}`;
  }

  private addDias(d: Date, n: number): Date {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
  }

  private hoje(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }
}
