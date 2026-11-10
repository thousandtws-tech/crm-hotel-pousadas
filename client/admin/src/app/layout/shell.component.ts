import { Component, computed, inject, signal, viewChild, ElementRef, OnInit, OnDestroy } from '@angular/core';
import { IsActiveMatchOptions, NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
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

const ATIVO_EXATO: IsActiveMatchOptions = {
  paths: 'exact', queryParams: 'ignored', matrixParams: 'ignored', fragment: 'ignored',
};
const ATIVO_PREFIXO: IsActiveMatchOptions = {
  paths: 'subset', queryParams: 'ignored', matrixParams: 'ignored', fragment: 'ignored',
};
/** Duração da transição de abrir/fechar grupo (casa com o CSS). */
const ANIMACAO_GRUPO_MS = 260;

/** Remove query string e fragment. */
function caminho(url: string): string {
  return url.split(/[?#]/)[0];
}

/** `url` é a própria rota ou está abaixo dela. */
function casaRota(url: string, rota: string): boolean {
  return url === rota || url.startsWith(rota + '/');
}

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
    <header class="header" [class.header-open]="aberta()">
      <div class="header-left">
        <button
          class="header_toggle"
          type="button"
          (click)="alternar()"
          aria-label="Alternar menu"
          [attr.aria-expanded]="aberta()"
        >
          <mat-icon>{{ aberta() ? 'menu_open' : 'menu' }}</mat-icon>
        </button>
        <div class="pagina">
          @if (pagina().grupo; as g) {
            <span class="pagina-grupo">{{ g }}</span>
          }
          <h1 class="pagina-titulo">{{ pagina().titulo }}</h1>
        </div>
      </div>

      <!-- ===== busca global (Ctrl+K) ===== -->
      <div class="busca-wrap">
        <div class="campo" (mousedown)="focarCampo($event)">
          <mat-icon class="campo-icone" aria-hidden="true">search</mat-icon>
          <input
            #buscaInput
            class="campo-input"
            type="text"
            inputmode="search"
            enterkeyhint="search"
            placeholder="Buscar reserva, cliente, quarto…"
            aria-label="Busca global"
            autocomplete="off"
            spellcheck="false"
            (input)="digitar($event)"
            (keydown)="buscaTecla($event)"
          />
          @if (termo()) {
            <button type="button" class="campo-limpar" aria-label="Limpar busca" (click)="limparBusca()">
              <mat-icon>close</mat-icon>
            </button>
          } @else {
            <kbd class="campo-kbd">Ctrl K</kbd>
          }
        </div>
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
        <span class="hoje">
          <mat-icon>event</mat-icon> {{ hoje }}
        </span>

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

        <span class="divisor" aria-hidden="true"></span>

        <!-- ===== menu do usuário ===== -->
        <div class="user-wrap">
          <button
            type="button"
            class="user-btn"
            (click)="menuUser.set(!menuUser())"
            aria-haspopup="menu"
            [attr.aria-expanded]="menuUser()"
            aria-label="Menu do usuário"
          >
            <span class="avatar" aria-hidden="true">{{ usuario().iniciais }}</span>
            <span class="user-txt">
              <span class="user-nome">{{ usuario().nome }}</span>
              <span class="user-papel">{{ usuario().papel }}</span>
            </span>
            <mat-icon class="user-seta" [class.user-seta-aberta]="menuUser()">expand_more</mat-icon>
          </button>

          @if (menuUser()) {
            <div class="user-fechar" (click)="menuUser.set(false)" (keydown)="menuUser.set(false)" role="button" tabindex="-1" aria-label="Fechar menu"></div>
            <div class="user-menu" role="menu">
              <div class="user-card">
                <span class="avatar avatar-lg" aria-hidden="true">{{ usuario().iniciais }}</span>
                <span class="user-card-txt">
                  <strong>{{ usuario().nome }}</strong>
                  <span>{{ usuario().login }} · {{ usuario().papel }}</span>
                </span>
              </div>
              @if (auth.isAdmin()) {
                <a class="user-item" role="menuitem" routerLink="/estabelecimento" (click)="menuUser.set(false)">
                  <mat-icon>home</mat-icon> Dados da pousada
                </a>
                <a class="user-item" role="menuitem" routerLink="/funcionarios" (click)="menuUser.set(false)">
                  <mat-icon>group</mat-icon> Equipe e acessos
                </a>
              }
              <button type="button" class="user-item user-sair" role="menuitem" (click)="auth.logout()">
                <mat-icon>logout</mat-icon> Sair
              </button>
            </div>
          }
        </div>
      </div>
    </header>

    <!-- backdrop mobile — toque fora fecha o menu -->
    <div class="scrim" [class.scrim-visivel]="aberta()" (click)="aberta.set(false)" (keydown)="aberta.set(false)" role="button" tabindex="-1" aria-label="Fechar menu"></div>

    <aside class="l-navbar" [class.expanded]="aberta()" aria-label="Navegação principal">
      <a class="nav_logo" routerLink="/dashboard" aria-label="Início">
        <img src="logo.svg" alt="INNJOY" />
      </a>

      <nav class="nav">
        @for (item of nav(); track item.rotulo) {
          @if (item.filhos) {
            <div class="nav_group" [class.aberto]="grupoAberto() === item.rotulo">
              <button
                type="button"
                class="nav_link nav_group-btn"
                [class.active]="grupoAtivo(item)"
                [title]="item.rotulo"
                [attr.aria-expanded]="grupoAberto() === item.rotulo"
                (click)="alternarGrupo(item, $event)"
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
                      [routerLinkActiveOptions]="opcoesAtivo(item, f)"
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
      </nav>

      <div class="nav_rodape" [title]="rt.online() ? 'Tempo real ativo' : 'Reconectando'">
        <span class="rt-dot" [class.rt-on]="rt.online()"></span>
        <span class="nav_name">{{ rt.online() ? 'Tempo real ativo' : 'Reconectando…' }}</span>
      </div>
    </aside>

    <main class="content" [class.content-open]="aberta()">
      <router-outlet />
    </main>

    @if (auth.autenticado()) {
      <app-maria />
    }
  `,
  styles: `
    :host { --shell-h: calc(var(--header-height) + 1rem); }

    /* =====================================================================
       HEADER — começa à direita da sidebar, nunca passa por baixo dela
       ===================================================================== */
    .header {
      position: fixed;
      top: 0;
      right: 0;
      left: var(--nav-width);
      height: var(--shell-h);
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 440px) minmax(0, 1fr);
      gap: 1.25rem;
      align-items: center;
      padding: 0 1.25rem 0 0.75rem;
      background-color: var(--inn-navbar);
      border-bottom: 1px solid rgba(255, 255, 255, 0.07);
      box-shadow: 0 2px 12px rgba(4, 30, 40, 0.18);
      z-index: 100;
      transition: left 0.25s ease;
    }
    .header-open { left: var(--nav-width-open); }

    .header-left { display: flex; align-items: center; gap: 0.75rem; min-width: 0; }
    .header_toggle {
      flex: none;
      display: inline-grid;
      place-items: center;
      width: 38px; height: 38px;
      color: #fff;
      background: none;
      border: none;
      border-radius: 10px;
      cursor: pointer;
      transition: background 0.15s;
    }
    .header_toggle:hover { background: rgba(255, 255, 255, 0.1); }

    .pagina { display: flex; flex-direction: column; justify-content: center; min-width: 0; line-height: 1.1; }
    .pagina-grupo {
      font-size: 0.62rem;
      font-weight: 700;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: rgba(255, 255, 255, 0.62);
    }
    .pagina-titulo {
      margin: 0;
      font-family: var(--font-display);
      font-size: 1.45rem;
      font-weight: 600;
      letter-spacing: 0.01em;
      color: #fff;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }

    /* busca — vidro sobre o header, vira branca no foco */
    .header .busca-wrap { width: 100%; display: block; }
    /* o campo é a caixa; ícone, input e atalho são itens flex — alinhados
       na mesma linha por construção, sem posicionamento absoluto */
    .campo {
      display: flex;
      align-items: center;
      gap: 8px;
      height: 40px;
      padding: 0 8px 0 12px;
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.1);
      color: #fff;
      cursor: text;
      transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;
    }
    .campo:hover { background: rgba(255, 255, 255, 0.14); }
    .campo:focus-within {
      background: #fff;
      border-color: #fff;
      color: #1f3640;
      box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.22);
    }
    .campo-icone {
      flex: none;
      font-size: 20px; width: 20px; height: 20px; line-height: 20px;
      opacity: 0.8;
    }
    .campo-input {
      flex: 1;
      min-width: 0;
      height: 100%;
      margin: 0;
      padding: 0;
      border: 0;
      outline: 0;
      background: transparent;
      box-shadow: none;
      color: inherit;
      font: inherit;
      font-size: 0.875rem;
      line-height: 1.2;
      text-overflow: ellipsis;
    }
    .campo-input::placeholder { color: currentColor; opacity: 0.65; }
    .campo-kbd {
      flex: none;
      padding: 3px 6px;
      border: 1px solid currentColor;
      border-radius: 6px;
      font-family: inherit;
      font-size: 0.66rem;
      font-weight: 600;
      line-height: 1;
      letter-spacing: 0.02em;
      white-space: nowrap;
      opacity: 0.6;
    }
    .campo-limpar {
      flex: none;
      display: inline-grid; place-items: center;
      width: 24px; height: 24px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: none;
      color: inherit;
      cursor: pointer;
      opacity: 0.7;
      transition: background 0.15s, opacity 0.15s;
    }
    .campo-limpar:hover { opacity: 1; background: rgba(125, 151, 161, 0.25); }
    .campo-limpar mat-icon { font-size: 16px; width: 16px; height: 16px; line-height: 16px; }

    .header-right {
      display: flex; align-items: center; gap: 0.75rem;
      justify-self: end;
      min-width: 0;
    }
    .hoje {
      display: inline-flex; align-items: center; gap: 0.4rem;
      font-size: 0.78rem;
      color: rgba(255, 255, 255, 0.8);
      white-space: nowrap;
      text-transform: capitalize;
    }
    .hoje mat-icon { font-size: 16px; width: 16px; height: 16px; }

    .header .sino {
      color: #fff;
      width: 38px; height: 38px;
      display: inline-grid; place-items: center;
      border-radius: 10px;
      padding: 0;
      transition: background 0.15s;
    }
    .header .sino:hover { background: rgba(255, 255, 255, 0.1); }
    .header .sino-badge { top: 3px; right: 2px; box-shadow: 0 0 0 2px var(--inn-navbar); }

    .divisor { width: 1px; height: 26px; background: rgba(255, 255, 255, 0.16); }

    /* ----- menu do usuário ----- */
    .user-wrap { position: relative; }
    .user-btn {
      display: flex; align-items: center; gap: 0.6rem;
      padding: 4px 6px 4px 4px;
      background: none; border: none; cursor: pointer;
      border-radius: 999px;
      color: #fff; font: inherit; text-align: left;
      transition: background 0.15s;
    }
    .user-btn:hover { background: rgba(255, 255, 255, 0.1); }
    .avatar {
      flex: none;
      display: inline-grid; place-items: center;
      width: 34px; height: 34px;
      border-radius: 50%;
      background: var(--inn-first);
      border: 1.5px solid var(--inn-gold);
      color: #fff;
      font-size: 0.72rem; font-weight: 700; letter-spacing: 0.04em;
    }
    .avatar-lg { width: 42px; height: 42px; font-size: 0.85rem; }
    .user-txt { display: flex; flex-direction: column; line-height: 1.15; max-width: 150px; }
    .user-nome {
      font-size: 0.82rem; font-weight: 600;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .user-papel { font-size: 0.68rem; color: rgba(255, 255, 255, 0.7); }
    .user-seta { font-size: 18px; width: 18px; height: 18px; transition: transform 0.2s; }
    .user-seta-aberta { transform: rotate(180deg); }
    .user-fechar { position: fixed; inset: 0; z-index: 150; }
    .user-menu {
      position: absolute; top: calc(100% + 10px); right: 0; z-index: 151;
      width: 260px;
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 12px 32px rgba(4, 30, 40, 0.22);
      padding: 6px;
      animation: user-in 0.15s ease-out;
    }
    @keyframes user-in { from { transform: translateY(-8px); opacity: 0; } }
    .user-card {
      display: flex; align-items: center; gap: 0.7rem;
      padding: 0.7rem 0.6rem 0.8rem;
      margin-bottom: 4px;
      border-bottom: 1px solid #e8eef1;
    }
    .user-card-txt { display: flex; flex-direction: column; min-width: 0; line-height: 1.25; }
    .user-card-txt strong {
      font-size: 0.88rem; color: #14303c;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .user-card-txt span { font-size: 0.72rem; color: #5b6f78; }
    .user-item {
      display: flex; align-items: center; gap: 0.65rem;
      width: 100%;
      padding: 0.55rem 0.6rem;
      border: 0; background: none; cursor: pointer;
      border-radius: 8px;
      font: inherit; font-size: 0.84rem; color: #24404b;
      text-decoration: none; text-align: left;
    }
    .user-item:hover { background: #f1f6f8; }
    .user-item mat-icon { font-size: 18px; width: 18px; height: 18px; color: #5b6f78; }
    .user-sair { color: #b02a37; }
    .user-sair mat-icon { color: #b02a37; }

    /* =====================================================================
       SIDEBAR — marca fixa no topo, só a lista rola, rodapé fixo
       ===================================================================== */
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

    .l-navbar {
      position: fixed;
      top: 0;
      left: 0;
      width: var(--nav-width);
      height: 100vh;
      height: 100dvh;
      display: flex;
      flex-direction: column;
      background-color: var(--inn-first);
      border-right: 1px solid rgba(255, 255, 255, 0.05);
      transition: width 0.25s ease, box-shadow 0.25s ease;
      z-index: 110;
      overflow: hidden;
    }
    .l-navbar.expanded { width: var(--nav-width-open); }

    /* desktop com mouse: rail expande temporariamente ao passar o cursor */
    @media (min-width: 769px) and (hover: hover) {
      .l-navbar:not(.expanded):hover {
        width: var(--nav-width-open);
        box-shadow: 8px 0 28px rgba(4, 20, 28, 0.35);
      }
      .l-navbar:not(.expanded):hover .nav_logo img { width: 130px; }
    }

    /* ----- marca: mesma altura do header, alinhada com ele ----- */
    .nav_logo {
      flex: none;
      height: var(--shell-h);
      display: flex;
      align-items: center;
      justify-content: center;
      border-bottom: 1px solid rgba(255, 255, 255, 0.07);
    }
    .nav_logo img {
      width: 130px; max-height: 44px; object-fit: contain;
      filter: brightness(0) invert(1);
      transition: width 0.25s ease;
    }
    .l-navbar:not(.expanded) .nav_logo img { width: 44px; }

    /* ----- lista: única área com rolagem; sem barra nativa (zero salto de
       layout ao abrir um grupo) — o esmaecimento indica que há mais itens ----- */
    .nav {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
      overscroll-behavior: contain;
      padding: 0.75rem 0 1rem;
      scrollbar-width: none;
      -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 12px, #000 calc(100% - 24px), transparent 100%);
      mask-image: linear-gradient(to bottom, transparent 0, #000 12px, #000 calc(100% - 24px), transparent 100%);
    }
    .nav::-webkit-scrollbar { display: none; }

    /* ----- links: pílulas com largura do container — na rail o texto é
       apenas recortado, sem regras duplicadas de mostrar/esconder ----- */
    .nav_link {
      position: relative;
      display: grid;
      grid-template-columns: 20px minmax(0, 1fr);
      align-items: center;
      column-gap: 12px;
      width: calc(100% - 20px);
      height: 40px;
      margin: 0 10px 2px;
      padding: 0 0 0 14px;
      border: 0;
      border-radius: 10px;
      background: none;
      color: var(--inn-link);
      font: inherit;
      font-size: 0.86rem;
      text-align: left;
      text-decoration: none;
      white-space: nowrap;
      overflow: hidden;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .nav_link:hover { color: #fff; background: var(--inn-navlink-hover); }
    .nav_link:focus-visible { outline: 2px solid var(--inn-gold); outline-offset: -2px; }
    .nav_link.active { color: #fff; background: var(--inn-navlink-hover); font-weight: 600; }
    .nav_link.active::before {
      content: '';
      position: absolute;
      left: 0; top: 9px; bottom: 9px;
      width: 3px;
      border-radius: 0 3px 3px 0;
      background: var(--inn-gold);
    }
    .nav_icon { font-size: 20px; width: 20px; height: 20px; }
    .nav_name { overflow: hidden; text-overflow: ellipsis; }

    /* ----- grupo (treeview) ----- */
    .nav_group-btn { grid-template-columns: 20px minmax(0, 1fr) 18px; padding-right: 10px; }
    .nav_arrow {
      font-size: 18px; width: 18px; height: 18px;
      transition: transform 0.25s;
    }
    .nav_group.aberto .nav_arrow { transform: rotate(-90deg); }
    /* grupo aberto: o destaque fica no filho ativo, não no pai */
    .nav_group.aberto > .nav_group-btn.active { background: none; }
    .nav_group.aberto > .nav_group-btn.active::before { display: none; }
    .nav_group.aberto > .nav_group-btn.active:hover { background: var(--inn-navlink-hover); }

    .nav_filhos {
      display: grid;
      grid-template-rows: 0fr;
      transition: grid-template-rows 0.25s ease;
    }
    .nav_filhos-in { overflow: hidden; }
    .nav_group.aberto .nav_filhos { grid-template-rows: 1fr; }
    .nav_sub {
      grid-template-columns: 7px minmax(0, 1fr);
      column-gap: 19px;
      height: 34px;
      padding-left: 20px;
      font-size: 0.8rem;
    }
    .nav_bullet {
      width: 7px; height: 7px;
      border: 1.5px solid currentColor;
      border-radius: 50%;
    }
    .nav_sub.active .nav_bullet { background: var(--inn-gold); border-color: var(--inn-gold); }

    /* rail recolhida (sem hover): filhos fechados e o pai volta a indicar a rota */
    @media (min-width: 769px) {
      .l-navbar:not(.expanded):not(:hover) .nav_filhos { grid-template-rows: 0fr; }
      .l-navbar:not(.expanded):not(:hover) .nav_group.aberto > .nav_group-btn.active {
        background: var(--inn-navlink-hover);
      }
      .l-navbar:not(.expanded):not(:hover) .nav_group.aberto > .nav_group-btn.active::before {
        display: block;
      }
    }

    /* ----- rodapé: estado do tempo real ----- */
    .nav_rodape {
      flex: none;
      display: flex;
      align-items: center;
      gap: 0.75rem;
      height: 44px;
      padding-left: 30px;
      border-top: 1px solid rgba(255, 255, 255, 0.07);
      color: var(--inn-link);
      font-size: 0.72rem;
      white-space: nowrap;
    }
    .rt-dot {
      flex: none;
      width: 8px; height: 8px;
      border-radius: 50%;
      background: #d9a441;
    }
    .rt-dot.rt-on {
      background: #3ecf8e;
      animation: rt-pulse 2s ease-in-out infinite;
    }
    @keyframes rt-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(62, 207, 142, 0.5); }
      50% { box-shadow: 0 0 0 5px rgba(62, 207, 142, 0); }
    }

    /* =====================================================================
       CONTEÚDO
       ===================================================================== */
    .content {
      margin-top: calc(var(--header-height) + 2rem);
      margin-left: calc(var(--nav-width) + 1rem);
      padding: 0 1rem 2rem 0;
      min-height: calc(100vh - var(--header-height) - 3rem);
      transition: margin-left 0.25s ease;
    }
    .content-open { margin-left: calc(var(--nav-width-open) + 1rem); }

    @media (max-width: 1180px) {
      .hoje { display: none; }
    }
    @media (max-width: 980px) {
      .user-txt, .user-seta, .divisor { display: none; }
      .user-btn { padding: 2px; }
    }

    /* ===== mobile: sidebar off-canvas, header de ponta a ponta ===== */
    @media (max-width: 768px) {
      .header, .header-open {
        left: 0;
        grid-template-columns: auto minmax(0, 1fr) auto;
        gap: 0.5rem;
        padding: 0 0.6rem;
      }
      .pagina { display: none; }
      .campo-kbd { display: none; }
      .header-right { gap: 0.35rem; }

      .l-navbar {
        left: -280px;
        width: 264px;
        transition: left 0.25s ease;
      }
      .l-navbar.expanded {
        left: 0;
        width: 264px;
        box-shadow: 4px 0 24px rgba(0, 0, 0, 0.4);
      }
      .l-navbar:not(.expanded) .nav_logo img { width: 130px; }
      .scrim { display: block; pointer-events: none; }
      .scrim-visivel { pointer-events: auto; }

      .content, .content-open {
        margin-left: 0.5rem;
        padding-right: 0.5rem;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .l-navbar, .header, .content, .nav_filhos, .nav_arrow, .scrim { transition: none; }
      .rt-dot.rt-on { animation: none; }
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

  /** Caminho atual (sem query/fragment) — fonte do título e do grupo ativo. */
  private readonly url = signal(caminho(this.router.url));

  /** Título do header: item do menu com a rota mais específica que casa. */
  protected readonly pagina = computed<{ titulo: string; grupo: string | null }>(() => {
    const url = this.url();
    let melhor: { titulo: string; grupo: string | null; peso: number } | null = null;
    for (const item of NAV) {
      for (const folha of item.filhos ?? [item]) {
        if (!casaRota(url, folha.rota)) continue;
        if (!melhor || folha.rota.length > melhor.peso) {
          melhor = {
            titulo: folha.rotulo,
            grupo: item.filhos ? item.rotulo : null,
            peso: folha.rota.length,
          };
        }
      }
    }
    return melhor ?? { titulo: 'Painel', grupo: null };
  });

  protected readonly menuUser = signal(false);
  protected readonly usuario = computed(() => {
    const u = this.auth.user();
    const partes = (u?.nome ?? '').trim().split(/\s+/).filter(Boolean);
    const iniciais = ((partes[0]?.[0] ?? '') + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase();
    return {
      nome: u?.nome ?? '',
      login: u?.login ?? '',
      papel: u?.nivel_nome ?? '',
      iniciais: iniciais || '?',
    };
  });

  protected readonly hoje = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  }).format(new Date());

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
      .subscribe((e) => {
        this.url.set(caminho(e.urlAfterRedirects));
        this.menuUser.set(false);
        this.sincronizarGrupoComRota();
      });
  }

  /** Rota atual dentro de um grupo → mantém ele aberto. */
  private sincronizarGrupoComRota(): void {
    const grupo = NAV.find((i) => this.grupoAtivo(i));
    if (grupo) this.grupoAberto.set(grupo.rotulo);
  }

  protected grupoAtivo(item: NavItem): boolean {
    const url = this.url();
    return !!item.filhos?.some((f) => casaRota(url, f.rota));
  }

  /**
   * Filho cuja rota é prefixo de um irmão (ex.: /financeiro × /financeiro/dre)
   * só acende com match exato — senão dois subitens ficam ativos juntos.
   */
  protected opcoesAtivo(pai: NavItem, filho: NavItem): IsActiveMatchOptions {
    const prefixoDeIrmao = !!pai.filhos?.some((f) => f !== filho && f.rota.startsWith(filho.rota + '/'));
    return prefixoDeIrmao ? ATIVO_EXATO : ATIVO_PREFIXO;
  }

  /** Hamburger: desktop alterna rail↔full; mobile abre/fecha overlay. */
  protected alternar(): void {
    this.aberta.update((v) => !v);
  }

  protected alternarGrupo(item: NavItem, ev: Event): void {
    // sidebar recolhida (desktop): expande e já abre o grupo
    if (window.innerWidth > 768 && !this.aberta()) this.aberta.set(true);
    const abrindo = this.grupoAberto() !== item.rotulo;
    this.grupoAberto.set(abrindo ? item.rotulo : null);
    // após a animação, garante o grupo inteiro visível dentro da lista
    const grupo = (ev.currentTarget as HTMLElement).parentElement;
    if (abrindo && grupo) {
      setTimeout(() => grupo.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), ANIMACAO_GRUPO_MS);
    }
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

  /** Clique na moldura do campo (ícone, margens) leva o foco ao input. */
  focarCampo(e: MouseEvent): void {
    const input = this.buscaInput()?.nativeElement;
    if (!input || e.target === input || (e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    input.focus();
  }

  /** Botão ✕: esvazia o campo e devolve o foco para nova busca. */
  limparBusca(): void {
    const input = this.buscaInput()?.nativeElement;
    if (input) {
      input.value = '';
      input.focus();
    }
    this.termo.set('');
    this.resultados.set([]);
    this.buscaCarregando.set(false);
    this.fecharBusca();
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
