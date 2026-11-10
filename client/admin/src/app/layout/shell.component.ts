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
  { rota: '/reservas', rotulo: 'Reservas', icone: 'calendar_month' },
  { rota: '/clientes', rotulo: 'Clientes', icone: 'person' },
  { rota: '/acomodacoes', rotulo: 'Acomodações', icone: 'hotel' },
  { rota: '/estacionamento', rotulo: 'Estacionamento', icone: 'directions_car' },
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
  { rota: '/frigobares', rotulo: 'Frigobar', icone: 'kitchen' },
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
  {
    rota: '/suprimentos',
    rotulo: 'Suprimentos',
    icone: 'inventory_2',
    filhos: [
      { rota: '/estoque', rotulo: 'Estoque', icone: 'inventory_2' },
      { rota: '/insumos', rotulo: 'Insumos', icone: 'science' },
      { rota: '/compras', rotulo: 'Compras', icone: 'shopping_cart' },
    ],
  },
  { rota: '/pagamentos', rotulo: 'Pagamentos', icone: 'credit_card', admin: true },
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
      { rota: '/financeiro/dre', rotulo: 'DRE', icone: 'monitoring' },
      { rota: '/financeiro/conciliacao', rotulo: 'Conciliação', icone: 'compare_arrows' },
      { rota: '/financeiro/split', rotulo: 'Split', icone: 'call_split' },
      { rota: '/financeiro/caixa', rotulo: 'Caixa', icone: 'point_of_sale' },
    ],
  },
  { rota: '/comunicacao', rotulo: 'Comunicação', icone: 'forum', admin: true },
  {
    rota: '/configuracoes',
    rotulo: 'Configurações',
    icone: 'settings',
    admin: true,
    filhos: [
      { rota: '/cms', rotulo: 'Site / Quartos', icone: 'web' },
      { rota: '/estabelecimento', rotulo: 'Pousada / Hotel', icone: 'home' },
      { rota: '/funcionarios', rotulo: 'Administrador', icone: 'lock_open' },
      { rota: '/auditoria', rotulo: 'Auditoria', icone: 'fact_check' },
    ],
  },
];

@Component({
  selector: 'app-shell',
  host: { '(document:keydown.control.k)': 'focarBusca($event)' },
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatIconModule, MariaWidgetComponent],
  template: `
    <header class="header">
      <button
        class="header_toggle"
        type="button"
        (click)="alternar()"
        aria-label="Alternar menu"
        [attr.aria-expanded]="aberta()"
      >
        <mat-icon>{{ aberta() ? 'close' : 'menu' }}</mat-icon>
      </button>

      <!-- ===== busca global (padrão Salesforce/HubSpot: Ctrl+K) ===== -->
      <div class="busca-wrap">
        <mat-icon class="busca-icone">search</mat-icon>
        <input
          #buscaInput
          class="busca-input"
          type="search"
          placeholder="Buscar reserva, cliente, quarto…"
          aria-label="Busca global"
          autocomplete="off"
          (input)="digitar($event)"
          (keydown)="buscaTecla($event)"
        />
        <kbd class="busca-kbd">Ctrl K</kbd>
        @if (buscaAberta()) {
          <div class="busca-fechar" (click)="fecharBusca()" (keydown)="fecharBusca()" role="button" tabindex="-1" aria-label="Fechar busca"></div>
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
            <div class="sino-fechar" (click)="notifs.fecharPainel()" (keydown)="notifs.fecharPainel()" role="button" tabindex="-1" aria-label="Fechar"></div>
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

    <!-- backdrop mobile — toque fora fecha o menu -->
    <div class="scrim" [class.scrim-visivel]="aberta()" (click)="aberta.set(false)" (keydown)="aberta.set(false)" role="button" tabindex="-1" aria-label="Fechar menu"></div>

    <aside class="l-navbar" [class.expanded]="aberta()" aria-label="Navegação principal">
      <nav class="nav">
        <div class="nav-inner">
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
                  <mat-icon class="nav_arrow">chevron_left</mat-icon>
                </button>
                <div class="nav_filhos">
                  <div class="nav_filhos-in">
                    @for (f of item.filhos; track f.rota) {
                      <a
                        class="nav_link nav_sub"
                        [routerLink]="f.rota"
                        routerLinkActive="active"
                        [title]="f.rotulo"
                        (click)="clicouNav()"
                      >
                        <span class="nav_bullet" aria-hidden="true"></span>
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
                (click)="clicouNav()"
              >
                <mat-icon class="nav_icon">{{ item.icone }}</mat-icon>
                <span class="nav_name">{{ item.rotulo }}</span>
              </a>
            }
          }
        </div>
      </nav>
    </aside>

    <main class="content" [class.content-open]="aberta()">
      <router-outlet />
    </main>

    @if (auth.autenticado()) {
      <app-maria />
    }
  `,
  styles: `
    /* ===== header fixo ===== */
    .header {
      width: 100%;
      height: calc(var(--header-height) + 1rem);
      position: fixed;
      top: 0;
      left: 0;
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      gap: 1rem;
      align-items: center;
      padding: 0 1rem;
      background-color: var(--inn-navbar);
      z-index: 100;
      transition: 0.25s ease;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
    }
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

    /* ===== backdrop — só visível em mobile via media query ===== */
    .scrim {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(6, 18, 24, 0.55);
      z-index: 105;
      opacity: 0;
      transition: opacity 0.25s ease;
    }
    .scrim-visivel { opacity: 1; }

    /* ===== sidebar — rail 68px ↔ 230px ===== */
    .l-navbar {
      position: fixed;
      top: 0;
      left: 0;
      width: var(--nav-width);
      height: 100vh;
      height: 100dvh;
      background-color: var(--inn-first);
      transition: width 0.25s ease;
      z-index: 110;
      overflow: hidden;
    }
    .l-navbar.expanded { width: var(--nav-width-open); }

    /* desktop: rail com hover-expand (padrão AdminLTE sidebar-mini) */
    @media (min-width: 769px) {
      .l-navbar:not(.expanded):hover { width: var(--nav-width-open); }
      .l-navbar:not(.expanded):hover .nav_name,
      .l-navbar:not(.expanded):hover .nav_arrow { display: block; }
      .l-navbar:not(.expanded):hover .nav_group-btn { grid-template-columns: max-content 1fr max-content; }
      .l-navbar:not(.expanded):hover .nav_group.aberto .nav_filhos { grid-template-rows: 1fr; }
      .l-navbar:not(.expanded):hover .nav_sub { padding-left: 2.6rem; }
      .l-navbar:not(.expanded):hover .nav_link { padding-left: 1.5rem; }
      .l-navbar:not(.expanded):hover .nav_logo img { width: 130px; }
    }

    .nav { height: 100%; overflow-y: auto; overflow-x: hidden; scrollbar-width: thin; }
    .nav-inner { display: flex; flex-direction: column; min-height: 100%; padding-bottom: 1rem; }

    /* ===== logo ===== */
    .nav_logo {
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0.5rem 0 0.25rem;
      padding: 0.5rem;
      cursor: pointer;
    }
    .nav_logo img {
      width: 130px; height: auto; object-fit: contain;
      filter: brightness(0) invert(1);
      transition: width 0.25s ease;
    }
    .l-navbar:not(.expanded) .nav_logo img { width: 46px; }

    /* ===== links ===== */
    .nav_link {
      position: relative;
      display: grid;
      grid-template-columns: max-content 1fr;
      align-items: center;
      column-gap: 1rem;
      padding: 0.55rem 0 0.55rem 1.5rem;
      margin-bottom: 0.15rem;
      color: var(--inn-link);
      font-size: 90%;
      border-left: 3px solid transparent;
      transition: background 0.15s, color 0.15s;
      text-decoration: none;
      min-width: var(--nav-width-open);
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
    .nav_icon { font-size: 1.15rem; width: 20px; height: 20px; }
    .nav_name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    /* ===== grupo expansível ===== */
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
    /* padrão AdminLTE: angle-left gira para baixo quando aberto */
    .nav_group.aberto .nav_arrow { transform: rotate(-90deg); }
    .nav_filhos {
      display: grid;
      grid-template-rows: 0fr;
      transition: grid-template-rows 0.25s ease;
    }
    .nav_filhos-in { overflow: hidden; }
    .nav_group.aberto .nav_filhos { grid-template-rows: 1fr; }
    .nav_sub { padding-left: 2.35rem; font-size: 84%; }
    /* fa-circle-o do AdminLTE — bolinha vazada nos subitens */
    .nav_bullet {
      width: 7px; height: 7px;
      border: 1.5px solid currentColor;
      border-radius: 50%;
      flex-shrink: 0;
      margin-right: 0.15rem;
    }

    /* rail colapsada: sem texto, sem seta, sem filhos empilhados */
    .l-navbar:not(.expanded) .nav_name,
    .l-navbar:not(.expanded) .nav_arrow { display: none; }
    .l-navbar:not(.expanded) .nav_filhos { grid-template-rows: 0fr; }
    .l-navbar:not(.expanded) .nav_link { padding-left: 1.35rem; }

    /* ===== botão sair ===== */
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
      transition: margin-left 0.25s ease;
    }
    .content-open { margin-left: calc(var(--nav-width-open) + 1rem); }

    /* ===== mobile: sidebar off-canvas ===== */
    @media (max-width: 768px) {
      .l-navbar {
        left: calc(-1 * var(--nav-width-open) - 8px);
        width: var(--nav-width-open);
        box-shadow: none;
        transition: left 0.25s ease;
      }
      .l-navbar.expanded {
        left: 0;
        box-shadow: 4px 0 24px rgba(0, 0, 0, 0.4);
      }
      .scrim { display: block; pointer-events: none; }
      .scrim-visivel { pointer-events: auto; }

      .content, .content-open {
        margin-left: 0.5rem;
        margin-right: 0;
        padding-right: 0.5rem;
      }
      .header { grid-template-columns: auto 1fr auto; gap: 0.5rem; padding: 0 0.6rem; }
      .busca-kbd { display: none; }
      .header .btn-dark-blue span { display: none; }
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

  /** Itens visíveis — filtra por permissão. */
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

  /** Todos os itens achatados — p/ resolver grupo ativo pela rota. */
  private todosItens(): NavItem[] {
    return NAV;
  }

  /** Rota atual dentro de um grupo → mantém ele aberto. */
  private sincronizarGrupoComRota(): void {
    const grupo = this.todosItens().find((i) => this.grupoAtivo(i));
    if (grupo) this.grupoAberto.set(grupo.rotulo);
  }

  protected grupoAtivo(item: NavItem): boolean {
    return !!item.filhos?.some((f) =>
      f.rota === this.router.url || this.router.url.startsWith(f.rota + '/'),
    );
  }

  /** Hamburger: desktop alterna rail↔full; mobile abre/fecha overlay. */
  protected alternar(): void {
    this.aberta.update((v) => !v);
  }

  protected alternarGrupo(item: NavItem): void {
    // sidebar recolhida (desktop): expande e já abre o grupo
    if (window.innerWidth > 768 && !this.aberta()) this.aberta.set(true);
    this.grupoAberto.update((g) => (g === item.rotulo ? null : item.rotulo));
  }

  /** Fecha a overlay após navegar — só em viewport mobile. */
  protected clicouNav(): void {
    if (window.innerWidth <= 768) this.aberta.set(false);
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
