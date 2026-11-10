import { Component, computed, inject, signal, viewChild, ElementRef, OnInit, OnDestroy } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { AuthStore } from '@core/services/auth.store';
import { Realtime } from '@core/services/realtime.service';
import { Notificacoes } from '@core/services/notificacoes.service';
import { ApiService } from '@core/services/api.service';
import { MariaWidgetComponent } from '@features/maria/maria-widget.component';
import { ItemBusca, Notificacao } from '@core/models/api.models';
import { Subject, debounceTime, distinctUntilChanged, filter } from 'rxjs';

interface NavItem {
  rota: string;
  rotulo: string;
  icone: string;
  admin?: boolean;
  /** Subitens — o item vira um grupo expansível (o `rota` serve só de chave). */
  filhos?: NavItem[];
}

/** Rótulo de cada grupo do dropdown de busca. */
const GRUPOS: Record<ItemBusca['tipo'], { rotulo: string; icone: string }> = {
  cliente: { rotulo: 'Clientes', icone: 'person' },
  reserva: { rotulo: 'Reservas', icone: 'calendar_month' },
  acomodacao: { rotulo: 'Acomodações', icone: 'hotel' },
  funcionario: { rotulo: 'Funcionários', icone: 'badge' },
  estoque: { rotulo: 'Estoque', icone: 'inventory_2' },
};

const NAV: NavItem[] = [
  { rota: '/dashboard', rotulo: 'Home', icone: 'grid_view' },
  { rota: '/clientes', rotulo: 'Clientes', icone: 'person' },
  { rota: '/estacionamento', rotulo: 'Estacionamento', icone: 'directions_car' },
  { rota: '/acomodacoes', rotulo: 'Acomodações', icone: 'hotel' },
  { rota: '/estoque', rotulo: 'Estoque', icone: 'inventory_2' },
  { rota: '/compras', rotulo: 'Compras', icone: 'shopping_cart' },
  { rota: '/frigobares', rotulo: 'Frigobar', icone: 'kitchen' },
  { rota: '/reservas', rotulo: 'Reservas', icone: 'calendar_month' },
  {
    rota: '/pdv',
    rotulo: 'Restaurante',
    icone: 'restaurant',
    filhos: [
      { rota: '/pdv', rotulo: 'PDV & Comandas', icone: 'point_of_sale' },
      { rota: '/cozinha', rotulo: 'Cozinha (KDS)', icone: 'soup_kitchen' },
      { rota: '/cafe', rotulo: 'Café da Manhã', icone: 'free_breakfast' },
    ],
  },
  {
    rota: '/financeiro',
    rotulo: 'Financeiro',
    icone: 'payments',
    admin: true,
    filhos: [
      { rota: '/financeiro', rotulo: 'Visão Geral', icone: 'dashboard' },
      { rota: '/financeiro/pagamentos-online', rotulo: 'Pagamentos Online', icone: 'credit_card' },
      { rota: '/financeiro/contas', rotulo: 'Contas', icone: 'account_balance' },
      { rota: '/financeiro/fluxo-caixa', rotulo: 'Fluxo de Caixa', icone: 'swap_vert' },
    ],
  },
  { rota: '/pagamentos', rotulo: 'Pagamentos', icone: 'credit_card', admin: true },
  { rota: '/cms', rotulo: 'Site / Quartos', icone: 'web', admin: true },
  { rota: '/comunicacao', rotulo: 'Comunicação', icone: 'forum', admin: true },
  {
    rota: '/operacao',
    rotulo: 'Operação',
    icone: 'engineering',
    admin: true,
    filhos: [
      { rota: '/operacao/governanca', rotulo: 'Governança', icone: 'cleaning_services' },
      { rota: '/operacao/manutencao', rotulo: 'Manutenção & PMOC', icone: 'build' },
      { rota: '/operacao/escalas', rotulo: 'Escalas & CLT', icone: 'schedule' },
    ],
  },
  { rota: '/estabelecimento', rotulo: 'Pousada / Hotel', icone: 'home', admin: true },
  { rota: '/funcionarios', rotulo: 'Administrador', icone: 'lock_open', admin: true },
];

@Component({
  selector: 'app-shell',
  host: { '(document:keydown.control.k)': 'focarBusca($event)' },
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatIconModule, MariaWidgetComponent],
  template: `
    <header class="header" [class.header-open]="aberta()">
      <button
        class="header_toggle"
        type="button"
        (click)="aberta.set(!aberta())"
        aria-label="Alternar menu"
      >
        <mat-icon>{{ aberta() ? 'close' : 'menu' }}</mat-icon>
      </button>

      <!-- ===== busca global (padrão Salesforce/HubSpot: Ctrl+K) ===== -->
      <div class="busca-wrap">
        @if (buscaAberta()) {
          <div class="busca-fechar" (click)="fecharBusca()"></div>
          <div class="busca-painel" role="listbox" aria-label="Resultados da busca">
            @if (buscaCarregando()) {
              <p class="busca-vazio">Buscando…</p>
            } @else if (!resultados().length) {
              <p class="busca-vazio">Nenhum resultado para "{{ termo() }}".</p>
            } @else {
              @for (g of grupos(); track g.tipo) {
                <p class="busca-grupo">
                  <mat-icon>{{ g.icone }}</mat-icon> {{ g.rotulo }}
                </p>
                @for (it of g.itens; track it.item.tipo + it.item.id) {
                  <button
                    type="button"
                    class="busca-item"
                    id="busca-item-{{ it.idx }}"
                    role="option"
                    [class.busca-ativa]="it.idx === buscaAtiva()"
                    [attr.aria-selected]="it.idx === buscaAtiva()"
                    (click)="irPara(it.item)"
                    (mouseenter)="buscaAtiva.set(it.idx)"
                  >
                    <span class="busca-tit">{{ it.item.titulo }}</span>
                    @if (it.item.sub) { <span class="busca-sub">{{ it.item.sub }}</span> }
                  </button>
                }
              }
            }
          </div>
        }
      </div>

      <div class="header-right">
        <!-- ===== sino de notificações ===== -->
        <div class="sino-wrap">
          <button
            type="button"
            class="sino"
            [class.sino-toca]="notifs.tocando()"
            (click)="notifs.alternarPainel()"
            aria-label="Notificações"
            [attr.aria-expanded]="notifs.aberto()"
          >
            <mat-icon>notifications</mat-icon>
            @if (notifs.naoLidas() > 0) {
              <span class="sino-badge">{{ notifs.naoLidas() > 99 ? '99+' : notifs.naoLidas() }}</span>
            }
          </button>

          @if (notifs.aberto()) {
            <div class="sino-fechar" (click)="notifs.fecharPainel()"></div>
            <div class="sino-painel" role="dialog" aria-label="Histórico de notificações">
              <div class="sino-head">
                <strong>Notificações</strong>
                @if (notifs.naoLidas() > 0) {
                  <button type="button" class="sino-ler-todas" (click)="notifs.lerTodas()">
                    Marcar todas como lidas
                  </button>
                }
              </div>
              <div class="sino-lista">
                @if (notifs.carregando()) {
                  <p class="sino-vazio">Carregando…</p>
                } @else {
                  @for (n of notifs.inbox(); track n.id) {
                    <div class="sino-item" [class.sino-nova]="!n.lida">
                      <button
                        type="button"
                        class="sino-item-btn"
                        (click)="abrirNotificacao(n)"
                      >
                        <span class="sino-dot" [class.sino-dot-alerta]="n.tipo === 'alerta'"></span>
                        <span class="sino-txt">
                          <span>{{ n.titulo }}</span>
                          <span>{{ n.mensagem }}</span>
                        </span>
                        <span class="sino-tempo">{{ notifs.tempoAtras(n.criado_em) }}</span>
                      </button>
                      @if (auth.isAdmin()) {
                        <button
                          type="button"
                          class="sino-del"
                          title="Remover do histórico"
                          aria-label="Remover notificação"
                          (click)="notifs.excluir(n)"
                        >
                          <mat-icon>delete</mat-icon>
                        </button>
                      }
                    </div>
                  } @empty {
                    <p class="sino-vazio">Nenhuma notificação ainda.</p>
                  }
                }
              </div>
            </div>
          }
        </div>
        <button class="btn-dark-blue" type="button" (click)="auth.logout()">
          <mat-icon style="font-size:16px;height:16px;width:16px">logout</mat-icon> Sair
        </button>
      </div>
    </header>

    <div class="l-navbar" [class.expanded]="aberta()">
      <nav class="nav">
        <div>
          <a class="nav_logo" routerLink="/dashboard" aria-label="INNJOY">
            <img src="logo.svg" alt="INNJOY" />
          </a>
          @for (item of nav(); track item.rotulo) {
            @if (item.filhos) {
              <div class="nav_group" [class.aberto]="grupoAberto() === item.rotulo">
                <button
                  type="button"
                  class="nav_link nav_group-btn"
                  [class.active]="grupoAtivo(item)"
                  [title]="item.rotulo"
                  [attr.aria-expanded]="grupoAberto() === item.rotulo"
                  (click)="alternarGrupo(item)"
                >
                  <mat-icon class="nav_icon">{{ item.icone }}</mat-icon>
                  <span class="nav_name">{{ item.rotulo }}</span>
                  <mat-icon class="nav_arrow">expand_more</mat-icon>
                </button>
                <div class="nav_filhos">
                  <div class="nav_filhos-in">
                    @for (f of item.filhos; track f.rota) {
                      <a
                        class="nav_link nav_sub"
                        [routerLink]="f.rota"
                        routerLinkActive="active"
                        [title]="f.rotulo"
                      >
                        <mat-icon class="nav_icon">{{ f.icone }}</mat-icon>
                        <span class="nav_name">{{ f.rotulo }}</span>
                      </a>
                    }
                  </div>
                </div>
              </div>
            } @else {
              <a
                class="nav_link"
                [routerLink]="item.rota"
                routerLinkActive="active"
                [title]="item.rotulo"
              >
                <mat-icon class="nav_icon">{{ item.icone }}</mat-icon>
                <span class="nav_name">{{ item.rotulo }}</span>
              </a>
            }
          }
        </div>
      </nav>
    </div>

    <main class="content" [class.content-open]="aberta()">
      <router-outlet />
    </main>

    @if (auth.autenticado()) {
      <app-maria />
    }
  `,
  styles: `
    /* ===== header fixo verde (AdminLTE skin-green .main-header) ===== */
    .header {
      width: 100%;
      height: calc(var(--header-height) + 1rem);
      position: fixed;
      top: 0;
      left: 0;
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: center;
      padding: 0 1rem 0 calc(var(--nav-width) + 1rem);
      background-color: var(--inn-navbar);
      z-index: 100;
      transition: 0.25s ease;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
    }
    .header-open { padding-left: calc(var(--nav-width-open) + 1rem); }
    .header-right {
      display: flex; align-items: center; gap: 1rem;
      justify-self: end;
    }
    .header_toggle {
      justify-self: start;
      display: inline-flex;
      align-items: center;
      color: #fff;
      font-size: 1.5rem;
      background: none;
      border: none;
      cursor: pointer;
      padding: 4px 8px;
      border-radius: 3px;
      transition: background 0.2s;
    }
    .header_toggle:hover { background: rgba(0, 0, 0, 0.1); }

    /* ===== navbar lateral escura ===== */
    .l-navbar {
      position: fixed;
      top: 0;
      left: 0;
      width: var(--nav-width);
      min-height: 100vh;
      background-color: var(--inn-first);
      padding: 1rem 1rem 0 0;
      transition: 0.25s ease;
      z-index: 100;
      overflow: hidden;
    }
    .l-navbar.expanded { width: var(--nav-width-open); }

    .nav { display: flex; overflow-y: auto; overflow-x: hidden; height: 100%; }

    /* ===== logo sobre a sidebar (sem faixa de fundo) ===== */
    .nav_logo {
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0.5rem 0 0.75rem;
      padding: 0.5rem 0.5rem;
      cursor: pointer;
      transition: 0.5s;
    }
    .nav_logo img {
      width: 130px; height: auto; object-fit: contain;
      filter: brightness(0) invert(1);
    }
    .l-navbar:not(.expanded) .nav_logo img { width: 46px; }

    /* ===== links — padrão AdminLTE .sidebar-menu ===== */
    .nav_link {
      position: relative;
      display: grid;
      grid-template-columns: max-content max-content;
      align-items: center;
      column-gap: 1rem;
      padding: 0.55rem 0 0.55rem 1.5rem;
      margin-bottom: 0.25rem;
      color: var(--inn-link);
      font-size: 90%;
      border-left: 3px solid transparent;
      transition: 0.2s;
    }
    .nav_link:hover {
      color: #fff;
      background: var(--inn-navlink-hover);
    }
    .nav_link.active {
      color: #fff;
      background: var(--inn-navlink-hover);
      border-left-color: var(--inn-gold);
    }
    .nav_icon { font-size: 1.1rem; width: 20px; height: 20px; }
    .nav_name { white-space: nowrap; }

    /* ===== grupo expansível (dropdown) ===== */
    .nav_group-btn {
      width: 100%;
      border: 0;
      background: none;
      font: inherit;
      cursor: pointer;
      text-align: left;
      grid-template-columns: max-content 1fr max-content;
    }
    .nav_arrow {
      font-size: 1.15rem; width: 18px; height: 18px;
      margin-right: 0.75rem;
      transition: transform 0.25s;
      color: var(--inn-link);
    }
    .nav_group.aberto .nav_arrow { transform: rotate(180deg); }
    /* colapsada: sem texto, a seta some (o grupo abre ao clicar e expandir) */
    .l-navbar:not(.expanded) .nav_arrow { display: none; }
    .nav_filhos {
      display: grid;
      grid-template-rows: 0fr;
      transition: grid-template-rows 0.25s ease;
    }
    .nav_filhos-in { overflow: hidden; }
    .nav_group.aberto .nav_filhos { grid-template-rows: 1fr; }
    /* colapsada: filhos sempre visíveis como ícones (mesmo padrão dos demais) */
    .l-navbar:not(.expanded) .nav_filhos { grid-template-rows: 1fr; }
    .nav_sub { padding-left: 2.6rem; font-size: 84%; }
    .l-navbar:not(.expanded) .nav_sub { padding-left: 1.5rem; }
    .l-navbar:not(.expanded) .nav_name { display: none; }
    .l-navbar:not(.expanded) .nav_link { padding-left: 1.35rem; }

    /* ===== indicador realtime (sobre navbar verde) ===== */
    .rt {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.75rem;
      color: rgba(255, 255, 255, 0.75);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .rt-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.4);
      transition: background 0.3s;
    }
    .rt-on { color: #fff; }
    .rt-on .rt-dot {
      background: #fff;
      animation: rt-pulse 1.6s ease-in-out infinite;
    }
    @keyframes rt-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(255, 255, 255, 0.45); }
      50% { box-shadow: 0 0 0 5px rgba(255, 255, 255, 0); }
    }

    /* ===== botão sair — flat sobre navbar verde (AdminLTE) ===== */
    .header .btn-dark-blue {
      background: rgba(0, 0, 0, 0.18);
      border-radius: 3px;
    }
    .header .btn-dark-blue:hover {
      background: rgba(0, 0, 0, 0.3);
      color: #fff;
    }
    .header .sino { color: #fff; }
    .header .sino:hover { background: rgba(0, 0, 0, 0.1); border-radius: 3px; }

    /* ===== conteúdo ===== */
    .content {
      margin-top: calc(var(--header-height) + 2rem);
      margin-left: calc(var(--nav-width) + 1rem);
      padding: 0 1rem 2rem 0;
      min-height: calc(100vh - var(--header-height) - 3rem);
      transition: 0.25s ease;
    }
    .content-open { margin-left: calc(var(--nav-width-open) + 1rem); }

    @media (max-width: 768px) {
      .l-navbar { width: 50px; }
      .l-navbar.expanded { width: var(--nav-width-open); }
      .header { padding-left: calc(50px + 1rem); }
      .content { margin-left: calc(50px + 0.5rem); padding-right: 0.5rem; }
      .content-open { margin-left: calc(50px + 0.5rem); }
    }
  `,
})
export class ShellComponent implements OnInit, OnDestroy {
  protected readonly auth = inject(AuthStore);
  protected readonly rt = inject(Realtime);
  protected readonly notifs = inject(Notificacoes);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  protected readonly aberta = signal(window.innerWidth > 768);
  protected readonly nav = computed(() =>
    NAV.filter((i) => !i.admin || this.auth.isAdmin()),
  );

  /** Rótulo do grupo aberto no dropdown — null = todos fechados. */
  protected readonly grupoAberto = signal<string | null>(null);

  // -- busca global ------------------------------------------------------------
  protected readonly termo = signal('');
  protected readonly resultados = signal<ItemBusca[]>([]);
  protected readonly buscaAberta = signal(false);
  protected readonly buscaCarregando = signal(false);
  /** Índice do item ativo na lista achatada (navegação ↑↓). */
  protected readonly buscaAtiva = signal(-1);
  private readonly buscaInput = viewChild<ElementRef<HTMLInputElement>>('buscaInput');
  private readonly termo$ = new Subject<string>();

  /** Lista achatada — ordem de exibição = ordem do teclado. */
  protected readonly plano = computed(() => this.resultados());

  /** Agrupa por `tipo` na ordem fixa de GRUPOS, preservando índice global. */
  protected readonly grupos = computed(() => {
    const itens = this.plano();
    const mapa = new Map<string, { item: ItemBusca; idx: number }[]>();
    itens.forEach((it, i) => {
      const g = mapa.get(it.tipo) ?? [];
      g.push({ item: it, idx: i });
      mapa.set(it.tipo, g);
    });
    return (Object.keys(GRUPOS) as ItemBusca['tipo'][])
      .filter((t) => mapa.has(t))
      .map((t) => ({ tipo: t, ...GRUPOS[t], itens: mapa.get(t)! }));
  });

  constructor() {
    this.termo$
      .pipe(debounceTime(250), distinctUntilChanged())
      .subscribe((t) => this.executarBusca(t));

    // abre o grupo da rota atual ao carregar e a cada navegação
    this.sincronizarGrupoComRota();
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(() => this.sincronizarGrupoComRota());
  }

  /** Rota atual dentro de um grupo → mantém ele aberto. */
  private sincronizarGrupoComRota(): void {
    const grupo = NAV.find((i) => this.grupoAtivo(i));
    if (grupo) this.grupoAberto.set(grupo.rotulo);
  }

  protected grupoAtivo(item: NavItem): boolean {
    return !!item.filhos?.some((f) => this.router.url.startsWith(f.rota));
  }

  protected alternarGrupo(item: NavItem): void {
    // sidebar recolhida: expande e já abre o grupo (ícones sem texto não servem)
    if (!this.aberta()) this.aberta.set(true);
    this.grupoAberto.update((g) => (g === item.rotulo ? null : item.rotulo));
  }

  ngOnInit(): void {
    this.rt.iniciar();
    this.notifs.iniciar();
  }

  ngOnDestroy(): void {
    this.rt.parar();
    this.termo$.complete();
  }

  // -- busca global ------------------------------------------------------------

  /** Ctrl+K foca o input (atalho global, padrão dos command palettes). */
  focarBusca(e: Event): void {
    e.preventDefault();
    this.buscaInput()?.nativeElement.focus();
  }

  digitar(e: Event): void {
    const t = (e.target as HTMLInputElement).value;
    this.termo.set(t);
    this.buscaAtiva.set(-1);
    if (t.trim().length < 2) {
      this.resultados.set([]);
      this.buscaAberta.set(false);
      this.buscaCarregando.set(false);
      return;
    }
    this.buscaAberta.set(true);
    this.buscaCarregando.set(true);
    this.termo$.next(t.trim());
  }

  private executarBusca(t: string): void {
    this.api.buscaGlobal(t).subscribe({
      next: (r) => {
        this.resultados.set(r);
        this.buscaCarregando.set(false);
      },
      error: () => {
        this.resultados.set([]);
        this.buscaCarregando.set(false);
      },
    });
  }

  /** ↑↓ percorrem, Enter navega, Esc fecha — padrão command palette. */
  buscaTecla(e: KeyboardEvent): void {
    const n = this.plano().length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.buscaAtiva.update((i) => (n ? (i + 1) % n : -1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.buscaAtiva.update((i) => (n ? (i - 1 + n) % n : -1));
    } else if (e.key === 'Enter') {
      const it = this.plano()[this.buscaAtiva()];
      if (it) {
        e.preventDefault();
        this.irPara(it);
      }
    } else if (e.key === 'Escape') {
      this.fecharBusca();
    }
  }

  irPara(it: ItemBusca): void {
    this.fecharBusca();
    void this.router.navigateByUrl(it.rota);
  }

  fecharBusca(): void {
    this.buscaAberta.set(false);
    this.buscaAtiva.set(-1);
  }

  /** Clica numa notificação: marca como lida e navega ao contexto. */
  abrirNotificacao(n: Notificacao): void {
    this.notifs.ler(n);
    const idreserva = n.dados?.idreserva;
    if (idreserva) {
      this.notifs.fecharPainel();
      void this.router.navigate(['/reservas', idreserva]);
    }
  }
}
