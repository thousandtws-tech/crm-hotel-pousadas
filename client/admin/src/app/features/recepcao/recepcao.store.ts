// Lógica e estado de recepcao — separada da camada de UI (recepcao.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { OnInit, computed, effect, inject, signal, Directive, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl } from '@angular/forms';
import { Router } from '@angular/router';
import { PageEvent } from '@angular/material/paginator';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { AcomodacoesApi } from '@core/api/acomodacoes.api';
import { OperacaoApi } from '@core/api/operacao.api';
import { ReservasApi } from '@core/api/reservas.api';
import { Acomodacao, Grupo, GrupoUnidadeView } from '@core/models/catalogo.models';
import { Bloqueio, MapaQuarto, ReservaResumo } from '@core/models/reservas.models';
import { StatusReserva } from '@core/models/comum.models';
import { NotifyService } from '@core/services/notify.service';
import { RealtimeService } from '@core/services/realtime.service';
import { ConfirmService } from '@core/services/confirm.service';
import { AuthStore } from '@core/services/auth.store';
import { num } from '@core/utils/num.utils';

const DIA_MS = 86_400_000;

/** Recepção — front desk operacional: fluxo do dia + mapa de quartos em tempo real. */
@Directive()
export abstract class RecepcaoStore implements OnInit {
  private readonly reservasApi = inject(ReservasApi);
  private readonly operacaoApi = inject(OperacaoApi);
  private readonly acomodacoesApi = inject(AcomodacoesApi);
  private readonly notify = inject(NotifyService);
  private readonly router = inject(Router);
  private readonly confirm = inject(ConfirmService);
  protected readonly auth = inject(AuthStore);
  protected readonly rt = inject(RealtimeService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly hoje = new Date();
  protected readonly chegadas = signal<ReservaResumo[]>([]);
  protected readonly saidas = signal<ReservaResumo[]>([]);
  protected readonly naCasa = signal<ReservaResumo[]>([]);
  protected readonly mapa = signal<MapaQuarto[]>([]);
  protected readonly bloqueios = signal<Bloqueio[]>([]);
  protected readonly bloqueioAlvo = signal<MapaQuarto | null>(null);
  protected readonly salvandoBloq = signal(false);
  protected bInicio = '';
  protected bFim = '';
  protected bMot = '';
  protected readonly filtroMapa = signal<'todos' | 'livre' | 'ocupado' | 'atencao'>('todos');
  protected readonly aguardando = signal<number | null>(null);
  protected readonly carregando = signal(true);
  protected readonly skel = [1, 2, 3];
  protected readonly skelMapa = Array.from({ length: 18 }, (_, i) => i);

  // ---- central de reservas (unificada na recepção) ------------------------------
  protected readonly items = signal<ReservaResumo[]>([]);
  protected readonly total = signal(0);
  protected readonly pagina = signal(1);
  protected readonly carregandoLista = signal(true);
  protected readonly fBusca = new FormControl('', { nonNullable: true });
  protected readonly buscaFoco = signal(false);
  protected readonly fStatus = signal<StatusReserva | ''>('');
  protected readonly statusFiltro: { id: StatusReserva | ''; rotulo: string }[] = [
    { id: '', rotulo: 'Todas' },
    { id: 'p', rotulo: 'Pendente' },
    { id: 'i', rotulo: 'Hospedado' },
    { id: 'f', rotulo: 'Finalizado' },
    { id: 'c', rotulo: 'Cancelada' },
  ];
  protected readonly modalNova = signal(false);
  protected readonly seedNova = signal<{
    idacomodacao: number;
    entrada: string;
    saida: string;
  } | null>(null);
  protected readonly hojeIso = this.isoLocal(new Date());
  /** Filtro de período da lista — inputs `date` nativos (mesmo padrão do modal de bloqueio). */
  protected fInicio = '';
  protected fFim = '';

  // ---- grupos / eventos ---------------------------------------------------------
  protected readonly grupos = signal<Grupo[]>([]);
  protected readonly rooming = signal<GrupoUnidadeView[]>([]);
  protected readonly roomingAberto = signal<number | null>(null);
  protected readonly salvandoGrupo = signal(false);
  protected readonly gSel = signal<Set<number>>(new Set());
  protected readonly acomodacoes = signal<Acomodacao[]>([]);
  protected gNome = '';
  protected gContato = '';
  protected gInicio = '';
  protected gFim = '';
  protected gBloquear = true;
  private readonly STATUS: Record<StatusReserva, { rotulo: string; bg: string; fg: string }> = {
    p: { rotulo: 'Pendente', bg: '#eef2f5', fg: '#8a6200' },
    i: { rotulo: 'Hospedado', bg: '#eef2f5', fg: '#1a6f8a' },
    f: { rotulo: 'Finalizado', bg: '#eef2f5', fg: '#40525d' },
    c: { rotulo: 'Cancelada', bg: '#eef2f5', fg: '#7d97a1' },
  };

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
        this.carregarLista();
      }
    });
    this.fBusca.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.recarregar());
  }

  ngOnInit(): void {
    this.carregar();
    this.carregarLista();
    this.carregarGrupos();
  }

  carregar(): void {
    this.carregando.set(true);
    // Data local (não UTC): toISOString vira o dia às 21h no horário de
    // Brasília — a recepção via chegadas do dia errado no turno da noite.
    const d = this.hoje;
    const hoje = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    // 1 request consolidada — backend resolve as 3 leituras em paralelo.
    this.reservasApi.bloqueios().subscribe({
      next: (b) => this.bloqueios.set(b),
      error: () => undefined,
    });
    this.reservasApi.painelRecepcao(hoje).subscribe({
      next: (p) => {
        this.chegadas.set(p.chegadas);
        this.naCasa.set(p.na_casa);
        this.saidas.set(p.na_casa.filter((r) => r.saidaprevista === hoje));
        this.mapa.set(p.mapa);
        this.carregando.set(false);
      },
      error: (e) => {
        this.carregando.set(false);
        this.notify.erro(e);
      },
    });
  }

  // ---- central de reservas ------------------------------------------------------

  carregarLista(): void {
    this.carregandoLista.set(true);
    this.reservasApi
      .listarReservas({
        busca: this.fBusca.value?.trim() || null,
        status: this.fStatus() || null,
        inicio: this.fInicio || null,
        fim: this.fFim || null,
        page: this.pagina(),
        porPagina: 10,
      })
      .subscribe({
        next: (p) => {
          this.items.set(p.items);
          this.total.set(p.total);
          this.carregandoLista.set(false);
        },
        error: (e) => {
          this.carregandoLista.set(false);
          this.notify.erro(e);
        },
      });
  }

  recarregar(): void {
    this.pagina.set(1);
    this.carregarLista();
  }

  mudouPagina(e: PageEvent): void {
    this.pagina.set(e.pageIndex + 1);
    this.carregarLista();
  }

  filtrarStatus(s: StatusReserva | ''): void {
    this.fStatus.set(s);
    this.recarregar();
  }

  limparRange(): void {
    this.fInicio = '';
    this.fFim = '';
    this.recarregar();
  }

  rangeAtiva(): boolean {
    return !!(this.fInicio || this.fFim);
  }

  temFiltro(): boolean {
    return !!this.fBusca.value?.trim() || !!this.fStatus() || this.rangeAtiva();
  }

  /** Atalhos dos cartões de KPI — aplicam o filtro correspondente na lista. */
  atalho(k: 'chegadas' | 'saidas' | 'hospedados' | 'pendentes'): void {
    this.fBusca.setValue('', { emitEvent: false });
    if (k === 'chegadas' || k === 'saidas') {
      this.fStatus.set(k === 'chegadas' ? 'p' : 'i');
      this.fInicio = this.hojeIso;
      this.fFim = this.hojeIso;
    } else {
      this.fStatus.set(k === 'hospedados' ? 'i' : 'p');
      this.fInicio = '';
      this.fFim = '';
    }
    this.recarregar();
  }

  // ---- grupos / eventos ---------------------------------------------------------

  carregarGrupos(): void {
    this.reservasApi
      .grupos()
      .subscribe({ next: (g) => this.grupos.set(g), error: () => undefined });
    if (!this.acomodacoes().length) {
      this.acomodacoesApi.listarAcomodacoes(1, 200, true).subscribe({
        next: (p) => this.acomodacoes.set(p.items),
        error: () => undefined,
      });
    }
  }

  toggleUnidade(id: number): void {
    this.gSel.update((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  criarGrupo(): void {
    if (!this.gNome.trim() || !this.gInicio || !this.gFim || this.gSel().size === 0) {
      this.notify.aviso('Nome, período e ao menos uma unidade são obrigatórios.');
      return;
    }
    this.salvandoGrupo.set(true);
    this.reservasApi
      .criarGrupo({
        nome: this.gNome.trim(),
        contato: this.gContato.trim() || null,
        inicio: this.gInicio,
        fim: this.gFim,
        unidades: [...this.gSel()],
        bloquear: this.gBloquear,
      })
      .subscribe({
        next: () => {
          this.salvandoGrupo.set(false);
          this.gNome = '';
          this.gContato = '';
          this.gInicio = '';
          this.gFim = '';
          this.gSel.set(new Set());
          this.notify.ok('Grupo criado.');
          this.carregarGrupos();
          this.carregar();
        },
        error: (e) => {
          this.salvandoGrupo.set(false);
          this.notify.erro(e);
        },
      });
  }

  toggleRooming(id: number): void {
    if (this.roomingAberto() === id) {
      this.roomingAberto.set(null);
      return;
    }
    this.roomingAberto.set(id);
    this.reservasApi.grupoUnidades(id).subscribe({
      next: (u) => this.rooming.set(u),
      error: () => this.rooming.set([]),
    });
  }

  async removerGrupo(g: Grupo): Promise<void> {
    const ok = await this.confirm.perguntar(
      `Remover o grupo '${g.nome}'? Os bloqueios vinculados são liberados; reservas permanecem.`,
      { titulo: 'Remover grupo', confirmar: 'Remover' },
    );
    if (!ok) return;
    this.reservasApi.removerGrupo(g.id).subscribe({
      next: () => {
        this.notify.ok('Grupo removido.');
        this.carregarGrupos();
        this.carregar();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  novaReserva(): void {
    this.seedNova.set(null);
    this.modalNova.set(true);
  }

  reservaCriada(): void {
    this.modalNova.set(false);
    this.seedNova.set(null);
    this.notify.ok('Reserva criada.');
    this.carregar();
    this.carregarLista();
  }

  fecharNova(): void {
    this.modalNova.set(false);
    this.seedNova.set(null);
  }

  async excluir(r: ReservaResumo): Promise<void> {
    const ok = await this.confirm.perguntar(
      `Excluir a reserva Nº${r.id} de ${r.cliente_nome}? A conta de consumo vinculada também será removida.`,
      { titulo: 'Excluir reserva', confirmar: 'Excluir' },
    );
    if (!ok) return;
    this.reservasApi.excluirReserva(r.id).subscribe({
      next: () => {
        this.notify.ok('Reserva excluída.');
        this.carregar();
        this.carregarLista();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  /** Bloqueio vigente do quarto (para desbloquear direto do card). */
  bloqueioDe(q: MapaQuarto): Bloqueio | undefined {
    return this.bloqueios().find((b) => b.idacomodacao === q.id);
  }

  /** Abre o modal de bloqueio com a semana corrente pré-preenchida. */
  abrirBloqueio(q: MapaQuarto, ev: Event): void {
    ev.stopPropagation();
    this.bInicio = this.isoLocal(this.hoje);
    const fim = new Date(this.hoje);
    fim.setDate(fim.getDate() + 7);
    this.bFim = this.isoLocal(fim);
    this.bMot = '';
    this.bloqueioAlvo.set(q);
  }

  salvarBloqueio(): void {
    const alvo = this.bloqueioAlvo();
    if (!alvo || !this.bInicio || !this.bFim || this.bFim <= this.bInicio) return;
    this.salvandoBloq.set(true);
    this.reservasApi.bloquear(alvo.id, this.bInicio, this.bFim, this.bMot.trim()).subscribe({
      next: () => {
        this.salvandoBloq.set(false);
        this.bloqueioAlvo.set(null);
        this.notify.ok(`${alvo.nome} bloqueado.`);
        this.carregar();
      },
      error: (e) => {
        this.salvandoBloq.set(false);
        this.notify.erro(e);
      },
    });
  }

  desbloquearQuarto(q: MapaQuarto, ev: Event): void {
    ev.stopPropagation();
    const b = this.bloqueioDe(q);
    if (!b) return;
    this.reservasApi.desbloquear(b.id).subscribe({
      next: () => {
        this.notify.ok(`${q.nome} desbloqueado.`);
        this.carregar();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  /** Chip de manutenção leva ao módulo com a OS filtrada por lá. */
  irManutencao(ev: Event): void {
    ev.stopPropagation();
    void this.router.navigate(['/operacao/manutencao']);
  }

  /** Conclui a tarefa de limpeza de hoje do quarto, direto no mapa. */
  marcarLimpa(q: MapaQuarto, ev: Event): void {
    ev.stopPropagation();
    if (!q.idtarefa_limpeza) return;
    this.operacaoApi.govStatus(q.idtarefa_limpeza, 'concluida').subscribe({
      next: () => {
        this.notify.ok(`Limpeza de ${q.nome} concluída.`);
        this.carregar();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  checkin(r: ReservaResumo): void {
    this.aguardando.set(r.id);
    this.reservasApi.checkin(r.id, null, null).subscribe({
      next: () => {
        this.aguardando.set(null);
        this.notify.ok(`Check-in de ${r.cliente_nome} realizado.`);
        this.carregar();
        this.carregarLista();
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

  /** Célula vazia do tape chart ou quarto livre → walk-in, sem sair da tela. */
  abrirNovaReserva(seed: { idacomodacao: number; entrada: string; saida: string }): void {
    this.seedNova.set(seed);
    this.modalNova.set(true);
  }

  private isoLocal(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  st(s: StatusReserva): { rotulo: string; bg: string; fg: string } {
    return this.STATUS[s];
  }

  parseDia(s: string): Date {
    const [y, m, d] = s.slice(0, 10).split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  noites(r: ReservaResumo): number {
    return this.diarias(r);
  }

  emCurso(r: ReservaResumo): boolean {
    const ini = r.entradaprevista.slice(0, 10);
    const fim = r.saidaprevista.slice(0, 10);
    return r.status === 'i' && ini <= this.hojeIso && fim > this.hojeIso;
  }

  chegaHoje(r: ReservaResumo): boolean {
    return r.status === 'p' && r.entradaprevista.slice(0, 10) === this.hojeIso;
  }

  protected readonly num = num;

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
