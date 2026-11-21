// Lógica e estado de reservas — separada da camada de UI (reservas.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { computed, inject, signal, OnInit, effect, Directive } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl } from '@angular/forms';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { PageEvent } from '@angular/material/paginator';
import { Router } from '@angular/router';
import { AcomodacoesApi } from '@core/api/acomodacoes.api';
import { ReservasApi } from '@core/api/reservas.api';
import { num } from '@core/utils/num.utils';
import { Acomodacao, Grupo, GrupoUnidadeView } from '@core/models/catalogo.models';
import { StatusReserva } from '@core/models/comum.models';
import { Bloqueio, MapaQuarto, ReservaResumo } from '@core/models/reservas.models';
import { ConfirmService } from '@core/services/confirm.service';
import { NotifyService } from '@core/services/notify.service';
import { RealtimeService } from '@core/services/realtime.service';
import { AuthStore } from '@core/services/auth.store';
import { TourService } from '@core/services/tour.service';

const DIA_MS = 86_400_000;
/** Largura de cada coluna-dia no mapa de ocupação. */
const COL_W = 84;
/** Quantidade de dias visíveis no mapa. */
const JANELA_DIAS = 14;
/** Altura da linha do mapa — mesma do `.tape-track` no CSS. */
const LIN_H = 48;

type Visao = 'lista' | 'cal' | 'mapa' | 'grupos';

/** Reservas — central de reservas com 4 visões: lista, calendário, mapa e grupos. */
@Directive()
export abstract class ReservasStore implements OnInit {
  protected readonly JANELA_DIAS = JANELA_DIAS;
  protected readonly rt = inject(RealtimeService);
  private readonly acomodacoesApi = inject(AcomodacoesApi);
  private readonly reservasApi = inject(ReservasApi);
  private readonly notify = inject(NotifyService);
  private readonly confirm = inject(ConfirmService);
  private readonly tour = inject(TourService);
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthStore);

  protected readonly modalNova = signal(false);
  protected readonly items = signal<ReservaResumo[]>([]);
  protected readonly total = signal(0);
  protected readonly pagina = signal(1);
  protected readonly carregando = signal(false);
  protected readonly aguardando = signal<number | null>(null);
  protected readonly num = num;
  protected readonly skel = [1, 2, 3, 4, 5, 6];
  protected readonly skelMapa = Array.from({ length: 12 }, (_, i) => i);
  protected readonly buscaFoco = signal(false);

  protected readonly fBusca = new FormControl('', { nonNullable: true });
  protected readonly fStatus = signal<StatusReserva | ''>('');
  protected readonly range = this.fb.group({
    inicio: [null as Date | null],
    fim: [null as Date | null],
  });

  protected readonly visoes: { id: Visao; rotulo: string; icone: string }[] = [
    { id: 'lista', rotulo: 'Lista', icone: 'view_list' },
    { id: 'cal', rotulo: 'Calendário', icone: 'calendar_view_week' },
    { id: 'mapa', rotulo: 'Mapa', icone: 'map' },
    { id: 'grupos', rotulo: 'Grupos', icone: 'groups' },
  ];
  protected readonly statusFiltro: { id: StatusReserva | ''; rotulo: string }[] = [
    { id: '', rotulo: 'Todas' },
    { id: 'p', rotulo: 'Pendente' },
    { id: 'i', rotulo: 'Hospedado' },
    { id: 'f', rotulo: 'Finalizado' },
    { id: 'c', rotulo: 'Cancelada' },
  ];

  // ---- mapa de ocupação -------------------------------------------------------
  protected readonly visao = signal<Visao>('lista');
  protected readonly mapa = signal<MapaQuarto[]>([]);
  protected readonly carregandoMapa = signal(false);
  protected readonly bloqueios = signal<Bloqueio[]>([]);
  protected readonly grupos = signal<Grupo[]>([]);
  protected readonly rooming = signal<GrupoUnidadeView[]>([]);
  protected readonly roomingAberto = signal<number | null>(null);
  protected readonly salvandoGrupo = signal(false);
  protected readonly gSel = signal<Set<number>>(new Set());
  protected gNome = '';
  protected gContato = '';
  protected readonly gRange = this.fb.group({
    inicio: [null as Date | null],
    fim: [null as Date | null],
  });
  protected gBloquear = true;
  protected readonly bloqueioAlvo = signal<MapaQuarto | null>(null);
  protected readonly salvandoBloq = signal(false);
  protected readonly bRange = this.fb.group({
    inicio: [null as Date | null],
    fim: [null as Date | null],
  });
  protected bMot = '';
  protected readonly andares = computed(() => {
    const por = new Map<number, MapaQuarto[]>();
    for (const q of this.mapa()) {
      const arr = por.get(q.andar) ?? [];
      arr.push(q);
      por.set(q.andar, arr);
    }
    return [...por.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([andar, quartos]) => ({ andar, quartos }));
  });
  protected readonly janelaInicio = signal<Date>(this.hoje());
  protected readonly dias = computed(() =>
    Array.from({ length: JANELA_DIAS }, (_, i) => this.addDias(this.janelaInicio(), i)),
  );
  protected readonly eventos = signal<ReservaResumo[]>([]);
  protected readonly eventosHoje = signal<ReservaResumo[]>([]);
  protected readonly acomodacoes = signal<Acomodacao[]>([]);
  protected readonly carregandoEventos = signal(false);
  protected readonly pendentesTotal = signal(0);
  protected readonly hojeIso = this.isoLocal(new Date());
  /** "terça-feira, 27 de outubro de 2026" — subtítulo do cabeçalho. */
  protected readonly hojeExtenso = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  /** Eventos agrupados por acomodação — linhas do mapa. */
  protected readonly eventosPorAcom = computed(() => {
    const m = new Map<number, ReservaResumo[]>();
    for (const e of this.eventos()) {
      const l = m.get(e.idacomodacao) ?? [];
      l.push(e);
      m.set(e.idacomodacao, l);
    }
    return m;
  });

  // ---- KPIs -------------------------------------------------------------------
  protected readonly chegadasHoje = computed(
    () =>
      this.eventosHoje().filter(
        (e) => e.entradaprevista.slice(0, 10) === this.hojeIso && e.status === 'p',
      ).length,
  );
  protected readonly saidasHoje = computed(
    () =>
      this.eventosHoje().filter(
        (e) => e.saidaprevista.slice(0, 10) === this.hojeIso && e.status === 'i',
      ).length,
  );
  protected readonly hospedados = computed(
    () => this.eventosHoje().filter((e) => e.status === 'i').length,
  );
  protected readonly pendentes = computed(() => this.pendentesTotal());

  /** Status na paleta da pousada (o STATUS_RESERVA global é do legado). */
  private readonly STATUS: Record<StatusReserva, { rotulo: string; bg: string; fg: string }> = {
    p: { rotulo: 'Pendente', bg: '#eef2f5', fg: '#8a6200' },
    i: { rotulo: 'Hospedado', bg: '#eef2f5', fg: '#1a6f8a' },
    f: { rotulo: 'Finalizado', bg: '#eef2f5', fg: '#40525d' },
    c: { rotulo: 'Cancelada', bg: '#eef2f5', fg: '#7d97a1' },
  };

  constructor() {
    let ultimo = -1;
    effect(() => {
      const v = this.rt.mudanca(
        'reserva',
        'consumo',
        'item_consumido',
        'adicional_consumo',
        'acomodacao',
        'bloqueio',
      );
      if (ultimo < 0) {
        ultimo = v;
        return;
      }
      if (v !== ultimo) {
        ultimo = v;
        this.carregar();
        this.carregarKpis();
        if (this.visao() === 'cal') this.carregarEventos();
        if (this.visao() === 'mapa') this.carregarMapa();
        if (this.visao() === 'grupos') this.carregarGrupos();
      }
    });
    this.fBusca.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe(() => this.recarregar());
    this.range.valueChanges.pipe(debounceTime(150), takeUntilDestroyed()).subscribe((v) => {
      if (v.inicio && v.fim) this.recarregar();
    });
  }

  ngOnInit(): void {
    this.carregar();
    this.carregarKpis();
    this.acomodacoesApi.listarAcomodacoes(1, 200, true).subscribe({
      next: (p) => this.acomodacoes.set(p.items),
      error: () => undefined,
    });
  }

  /** Recarrega a visão ativa + KPIs (botão de refresh do cabeçalho). */
  atualizar(): void {
    this.carregar();
    this.carregarKpis();
    if (this.visao() === 'cal') this.carregarEventos();
    if (this.visao() === 'mapa') this.carregarMapa();
    if (this.visao() === 'grupos') this.carregarGrupos();
  }

  // ---- lista -----------------------------------------------------------------

  carregar(): void {
    this.carregando.set(true);
    const { inicio, fim } = this.range.getRawValue();
    this.reservasApi
      .listarReservas({
        busca: this.fBusca.value?.trim() || null,
        status: this.fStatus() || null,
        inicio: inicio ? this.isoLocal(inicio) : null,
        fim: fim ? this.isoLocal(fim) : null,
        page: this.pagina(),
        porPagina: 24,
      })
      .subscribe({
        next: (p) => {
          this.items.set(p.items);
          this.total.set(p.total);
          this.carregando.set(false);
        },
        error: (e) => {
          this.carregando.set(false);
          this.notify.erro(e);
        },
      });
  }

  recarregar(): void {
    this.pagina.set(1);
    this.carregar();
  }

  mudouPagina(e: PageEvent): void {
    this.pagina.set(e.pageIndex + 1);
    this.carregar();
  }

  filtrarStatus(s: StatusReserva | ''): void {
    this.fStatus.set(s);
    this.recarregar();
  }

  limparRange(): void {
    this.range.reset({ inicio: null, fim: null }, { emitEvent: false });
    this.recarregar();
  }

  rangeAtiva(): boolean {
    const v = this.range.getRawValue();
    return !!(v.inicio || v.fim);
  }

  temFiltro(): boolean {
    return !!this.fBusca.value?.trim() || !!this.fStatus() || this.rangeAtiva();
  }

  /** Atalhos dos cartões de KPI — aplicam o filtro correspondente na lista. */
  atalho(k: 'chegadas' | 'saidas' | 'hospedados' | 'pendentes'): void {
    this.visao.set('lista');
    this.fBusca.setValue('', { emitEvent: false });
    const hoje = this.hoje();
    if (k === 'chegadas') {
      this.fStatus.set('p');
      this.range.setValue({ inicio: hoje, fim: hoje }, { emitEvent: false });
    } else if (k === 'saidas') {
      this.fStatus.set('i');
      this.range.setValue({ inicio: hoje, fim: hoje }, { emitEvent: false });
    } else {
      this.fStatus.set(k === 'hospedados' ? 'i' : 'p');
      this.range.reset({ inicio: null, fim: null }, { emitEvent: false });
    }
    this.recarregar();
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
    this.carregarKpis();
    if (this.visao() === 'cal') this.carregarEventos();
  }

  /** Check-in direto da lista — reservas que chegam hoje. */
  checkin(r: ReservaResumo): void {
    this.aguardando.set(r.id);
    this.reservasApi.checkin(r.id, null, null).subscribe({
      next: () => {
        this.aguardando.set(null);
        this.notify.ok(`Check-in de ${r.cliente_nome} realizado.`);
        this.carregar();
        this.carregarKpis();
      },
      error: (e) => {
        this.aguardando.set(null);
        this.notify.erro(e);
      },
    });
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
        this.carregarKpis();
      },
      error: (e) => this.notify.erro(e),
    });
  }

  // ---- KPIs / eventos ----------------------------------------------------------

  // ---------- mapa por andar + bloqueio ----------
  carregarMapa(): void {
    this.carregandoMapa.set(true);
    this.reservasApi.mapaQuartos().subscribe({
      next: (m) => {
        this.mapa.set(m);
        this.carregandoMapa.set(false);
      },
      error: () => this.carregandoMapa.set(false),
    });
    this.reservasApi
      .bloqueios()
      .subscribe({ next: (b) => this.bloqueios.set(b), error: () => undefined });
  }

  statusQuarto(a: MapaQuarto): string {
    if (a.bloqueado) return 'qt-bloq';
    if (a.status_hoje === 'i') return 'qt-ocup';
    if (a.status_hoje === 'p') return 'qt-pend';
    return 'qt-livre';
  }

  bloqueioDe(idacomodacao: number): Bloqueio | undefined {
    const hoje = new Date().toISOString().slice(0, 10);
    return this.bloqueios().find(
      (b) => b.idacomodacao === idacomodacao && b.inicio <= hoje && b.fim >= hoje,
    );
  }

  // ---------- grupos / eventos ----------
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
    const { inicio, fim } = this.gRange.getRawValue();
    if (!this.gNome.trim() || !inicio || !fim || this.gSel().size === 0) {
      this.notify.aviso('Nome, período e ao menos uma unidade são obrigatórios.');
      return;
    }
    this.salvandoGrupo.set(true);
    this.reservasApi
      .criarGrupo({
        nome: this.gNome.trim(),
        contato: this.gContato.trim() || null,
        inicio: this.isoLocal(inicio),
        fim: this.isoLocal(fim),
        unidades: [...this.gSel()],
        bloquear: this.gBloquear,
      })
      .subscribe({
        next: () => {
          this.salvandoGrupo.set(false);
          this.gNome = '';
          this.gContato = '';
          this.gSel.set(new Set());
          this.gRange.reset({ inicio: null, fim: null }, { emitEvent: false });
          this.notify.ok('Grupo criado.');
          this.carregarGrupos();
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
      },
      error: (e) => this.notify.erro(e),
    });
  }

  abrirBloqueio(a: MapaQuarto): void {
    this.bRange.reset({ inicio: null, fim: null }, { emitEvent: false });
    this.bMot = '';
    this.bloqueioAlvo.set(a);
  }

  confirmarBloqueio(): void {
    const a = this.bloqueioAlvo();
    const { inicio, fim } = this.bRange.getRawValue();
    if (!a || !inicio || !fim || this.bMot.trim().length < 3) return;
    this.salvandoBloq.set(true);
    this.reservasApi
      .bloquear(a.id, this.isoLocal(inicio), this.isoLocal(fim), this.bMot.trim())
      .subscribe({
        next: () => {
          this.salvandoBloq.set(false);
          this.bloqueioAlvo.set(null);
          this.carregarMapa();
        },
        error: () => this.salvandoBloq.set(false),
      });
  }

  desbloquear(id: number): void {
    this.reservasApi
      .desbloquear(id)
      .subscribe({ next: () => this.carregarMapa(), error: () => undefined });
  }

  carregarKpis(): void {
    this.reservasApi.eventosReserva(this.hojeIso, this.hojeIso).subscribe({
      next: (ev) => this.eventosHoje.set(ev),
      error: () => undefined,
    });
    this.reservasApi.listarReservas({ status: 'p', porPagina: 1 }).subscribe({
      next: (p) => this.pendentesTotal.set(p.total),
      error: () => undefined,
    });
  }

  // ---- mapa de ocupação ---------------------------------------------------------

  mudarVisao(v: Visao): void {
    this.visao.set(v);
    // Cada visão carrega seus dados sob demanda na primeira abertura.
    if (v === 'cal' && this.eventos().length === 0) this.carregarEventos();
    if (v === 'mapa' && this.mapa().length === 0) this.carregarMapa();
    if (v === 'grupos' && this.grupos().length === 0) this.carregarGrupos();
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
    this.carregandoEventos.set(true);
    const ini = this.isoLocal(this.dias()[0]);
    const fim = this.isoLocal(this.addDias(this.dias()[0], JANELA_DIAS));
    this.reservasApi.eventosReserva(ini, fim).subscribe({
      next: (ev) => {
        this.eventos.set(ev);
        this.carregandoEventos.set(false);
      },
      error: (e) => {
        this.carregandoEventos.set(false);
        this.notify.erro(e);
      },
    });
  }

  eventosDe(idacomodacao: number): ReservaResumo[] {
    return this.eventosPorAcom().get(idacomodacao) ?? [];
  }

  /** Geometria da barra no mapa — null quando fora da janela visível. */
  barGeo(r: ReservaResumo): { l: number; w: number } | null {
    const ini = this.parseDia(r.entradaprevista);
    const fim = this.parseDia(r.saidaprevista);
    const jIni = this.janelaInicio();
    const jFim = this.addDias(jIni, JANELA_DIAS);
    if (fim <= jIni || ini >= jFim) return null;
    const s = ini > jIni ? ini : jIni;
    const e = fim < jFim ? fim : jFim;
    const l = ((s.getTime() - jIni.getTime()) / DIA_MS) * COL_W;
    const w = ((e.getTime() - s.getTime()) / DIA_MS) * COL_W - 3;
    return { l, w: Math.max(w, 18) };
  }

  // ---- drag do mapa (remanejamento) --------------------------------------------

  /** Barra em arraste — dx/dy em px; o template aplica via transform. */
  protected readonly arrastando = signal<{ r: ReservaResumo; dx: number; dy: number } | null>(
    null,
  );
  /** Pré-seleção do modal de nova reserva (clique em célula vazia = walk-in). */
  protected readonly seedNova = signal<{
    idacomodacao: number;
    entrada: string;
    saida: string;
  } | null>(null);

  /** Período destino do arraste — exibido dentro da barra enquanto arrasta. */
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

  /** Inicia o arraste — só reservas pendentes movem (regra do backend). */
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
      const dAcom = Math.round(dy / LIN_H);
      if (dDias !== 0 || dAcom !== 0) {
        // O click dispara logo após o mouseup — suprime a navegação para o
        // detalhe; o timeout limpa a flag quando o soltar acontece fora do
        // elemento (click que nunca vem).
        this.suprimirClique = true;
        setTimeout(() => (this.suprimirClique = false));
        this.aplicarRemanejo(r, dDias, dAcom);
      }
    };
    window.addEventListener('mousemove', mover);
    window.addEventListener('mouseup', soltar);
  }

  /** Clique na barra sem deslocamento abre o detalhe; após o drag, ignora. */
  cliqueReserva(r: ReservaResumo): void {
    if (this.suprimirClique) {
      this.suprimirClique = false;
      return;
    }
    this.router.navigate(['/reservas', r.id]);
  }

  private aplicarRemanejo(r: ReservaResumo, dDias: number, dAcom: number): void {
    const lista = this.acomodacoes();
    const idx = lista.findIndex((a) => a.id === r.idacomodacao);
    const alvo = lista[idx + dAcom];
    if (dAcom !== 0 && !alvo) return; // soltou fora das linhas — barra volta sozinha
    const entrada = this.isoLocal(this.addDias(this.parseDia(r.entradaprevista), dDias));
    const saida = this.isoLocal(this.addDias(this.parseDia(r.saidaprevista), dDias));
    this.reservasApi
      .remanejar(r.id, {
        idacomodacao: alvo?.id ?? r.idacomodacao,
        entradaprevista: entrada,
        saidaprevista: saida,
      })
      .subscribe({
        next: () => {
          this.notify.ok('Reserva remanejada.');
          this.carregarEventos();
        },
        error: (e) => {
          this.notify.erro(e);
          this.carregarEventos();
        },
      });
  }

  /** Clique em célula vazia do mapa → nova reserva pré-preenchida (walk-in). */
  novaReservaEm(a: Acomodacao, d: Date): void {
    this.seedNova.set({
      idacomodacao: a.id,
      entrada: this.isoLocal(d),
      saida: this.isoLocal(this.addDias(d, 1)),
    });
    this.modalNova.set(true);
  }

  fecharNova(): void {
    this.modalNova.set(false);
    this.seedNova.set(null);
  }

  // ---- helpers ----------------------------------------------------------------

  st(s: StatusReserva): { rotulo: string; bg: string; fg: string } {
    return this.STATUS[s];
  }

  /** 'YYYY-MM-DD' → Date local (meia-noite) — evita o dia anterior do fuso. */
  parseDia(s: string): Date {
    const [y, m, d] = s.slice(0, 10).split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  isoLocal(d: Date): string {
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${dd}`;
  }

  hoje(): Date {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }

  addDias(d: Date, n: number): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  }

  noites(r: ReservaResumo): number {
    const ms =
      this.parseDia(r.saidaprevista).getTime() - this.parseDia(r.entradaprevista).getTime();
    return Math.max(1, Math.round(ms / DIA_MS));
  }

  emCurso(r: ReservaResumo): boolean {
    const ini = r.entradaprevista.slice(0, 10);
    const fim = r.saidaprevista.slice(0, 10);
    return r.status === 'i' && ini <= this.hojeIso && fim > this.hojeIso;
  }

  chegaHoje(r: ReservaResumo): boolean {
    return r.status === 'p' && r.entradaprevista.slice(0, 10) === this.hojeIso;
  }

  iniciais(nome: string): string {
    const partes = nome.trim().split(/\s+/);
    const a = partes[0]?.[0] ?? '?';
    const b = partes.length > 1 ? partes[partes.length - 1][0] : '';
    return (a + b).toUpperCase();
  }

  primeiroNome(nome: string): string {
    const p = nome.trim().split(/\s+/)[0] ?? nome;
    return p ? p[0].toUpperCase() + p.slice(1).toLowerCase() : '';
  }

  /** Nome completo do hóspede em Title Case para exibição na barra. */
  nomeCompleto(nome: string): string {
    return nome
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => p[0].toUpperCase() + p.slice(1).toLowerCase())
      .join(' ');
  }

  /** Tour guiado da tela (driver.js). */
  iniciarTour(): void {
    this.tour.iniciar([
      {
        popover: {
          title: 'Bem-vindo à Central de Reservas!',
          description:
            'A gestão de reservas da pousada em versão profissional — igual aos ' +
            'sistemas dos grandes hotéis. Avance com <b>Próximo</b> e feche no ✕ ou Esc.',
        },
      },
      {
        element: '#tour-kpis',
        popover: {
          title: 'Visão do dia',
          description:
            '<b>Chegadas</b> e <b>saídas</b> previstas para hoje, quem está ' +
            'hospedado e quantas reservas pendentes existem. Clicar num cartão ' +
            'já filtra a lista!',
          side: 'bottom',
        },
      },
      {
        element: '#tour-visao',
        popover: {
          title: 'Quatro visões',
          description:
            '<b>Lista</b> mostra a tabela detalhada · <b>Calendário</b> abre o ' +
            'mapa de ocupação · <b>Mapa</b> mostra os quartos por andar · ' +
            '<b>Grupos</b> gerencia eventos e rooming lists.',
          side: 'bottom',
        },
      },
      {
        element: '#tour-busca',
        popover: {
          title: 'Busca instantânea',
          description:
            'Digite <b>nome do hóspede</b>, <b>acomodação</b> ou <b>nº da ' +
            'reserva</b> — a lista filtra sozinha, sem apertar botão.',
          side: 'bottom',
        },
      },
      {
        element: '#tour-status',
        popover: {
          title: 'Filtro por status',
          description:
            '<b>Pendente</b> = reserva futura · <b>Hospedado</b> = check-in ' +
            'feito · <b>Finalizado</b> = check-out concluído · ' +
            '<b>Cancelada</b> = reserva desfeita.',
          side: 'bottom',
        },
      },
      {
        element: '.rs-range',
        popover: {
          title: 'Filtro por período',
          description:
            'Escolha <b>entrada e saída</b> no calendário para ver só reservas ' +
            'daquele intervalo — ótimo para fechar o mês.',
          side: 'bottom',
        },
      },
      {
        element: '#tour-nova',
        popover: {
          title: 'Nova reserva',
          description:
            'Abre o assistente de reserva: escolha o hóspede, as datas e a ' +
            'acomodação — o sistema já mostra a <b>disponibilidade</b>.',
          side: 'bottom',
        },
      },
      {
        element: '#tour-tabela',
        popover: {
          title: 'Lista de reservas',
          description:
            'Cada linha mostra hóspede, acomodação, período com <b>noites</b>, ' +
            'diária e status — com selo "em curso" e "chega hoje". Reservas que ' +
            'chegam hoje têm <b>check-in em um clique</b> direto na linha.',
          side: 'top',
        },
      },
      {
        element: 'tr.rs-row .rs-ver',
        skipMissingElement: true,
        popover: {
          title: 'Abrir a reserva',
          description:
            'O <b>olho teal</b> abre a ficha completa: check-in, consumo do ' +
            'frigobar, adicionais e check-out com forma de pagamento.',
          side: 'left',
        },
      },
      {
        popover: {
          title: 'Mapa de ocupação',
          description:
            'No botão <b>Calendário</b> cada barra colorida é uma reserva na ' +
            'cor da acomodação. Clique na barra para abrir a reserva e use ' +
            '‹ › para navegar pelas semanas.',
        },
      },
      {
        popover: {
          title: 'Pronto!',
          description:
            'Você já conhece a Central de Reservas. Para rever, clique no ' +
            'ícone de <b>tutorial</b> no topo a qualquer momento.',
        },
      },
    ]);
  }
}
