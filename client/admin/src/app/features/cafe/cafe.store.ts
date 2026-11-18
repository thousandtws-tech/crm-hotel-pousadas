// Lógica e estado de cafe — separada da camada de UI (cafe.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { OnDestroy, OnInit, computed, effect, inject, signal, Directive } from '@angular/core';
import { CafeApi } from '@core/api/cafe.api';
import { Realtime } from '../../core/services/realtime.service';
import { Notify } from '../../core/services/notify.service';
import { CafeQuadroItem } from '@core/models/cafe.models';

type FiltroPresenca = 'todas' | 'aguardando' | 'presentes';

@Directive()
export abstract class CafeStore implements OnInit, OnDestroy {
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
  readonly pessoasServidas = computed(() =>
    this.quadro().reduce((s, r) => s + (r.presenca_quantidade ?? 0), 0),
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

  ngOnDestroy(): void {
    /* nada a limpar */
  }

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
        this.notify.erro(
          typeof m === 'string' ? m : (m?.mensagem ?? 'Não foi possível registrar.'),
        );
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
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
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
