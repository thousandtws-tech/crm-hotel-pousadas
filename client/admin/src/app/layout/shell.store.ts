// Lógica e estado de shell — separada da camada de UI (shell.component.ts).
// O componente herda os membros; templates e comportamento não mudam.
import { computed, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { IsActiveMatchOptions, NavigationEnd, Router } from '@angular/router';
import { AuthStore } from '@core/services/auth.store';
import { Realtime } from '@core/services/realtime.service';
import { Notificacoes } from '@core/services/notificacoes.service';
import { Notificacao } from '@core/models/notificacoes.models';
import { filter } from 'rxjs';
import { Directive } from '@angular/core';

interface NavItem {
  rota: string;
  rotulo: string;
  icone: string;
  admin?: boolean;
  /** Subitens — o item vira um grupo expansível (o `rota` serve só de chave). */
  filhos?: NavItem[];
}

const ATIVO_EXATO: IsActiveMatchOptions = {
  paths: 'exact',
  queryParams: 'ignored',
  matrixParams: 'ignored',
  fragment: 'ignored',
};
const ATIVO_PREFIXO: IsActiveMatchOptions = {
  paths: 'subset',
  queryParams: 'ignored',
  matrixParams: 'ignored',
  fragment: 'ignored',
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
  { rota: '/recepcao', rotulo: 'Recepção', icone: 'room_service' },
  { rota: '/reservas', rotulo: 'Reservas', icone: 'calendar_month' },
  { rota: '/operadoras', rotulo: 'Operadoras', icone: 'handshake' },
  { rota: '/contratos', rotulo: 'Contratos', icone: 'corporate_fare' },
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
      { rota: '/financeiro/dre', rotulo: 'DRE', icone: 'assessment' },
      { rota: '/financeiro/conciliacao', rotulo: 'Conciliação', icone: 'compare_arrows' },
      { rota: '/financeiro/split', rotulo: 'Split', icone: 'call_split' },
      { rota: '/financeiro/caixa', rotulo: 'Caixa', icone: 'point_of_sale' },
    ],
  },
  { rota: '/comunicacao', rotulo: 'Comunicação', icone: 'forum', admin: true },
  { rota: '/inteligencia', rotulo: 'Inteligência', icone: 'psychology', admin: true },
  {
    rota: '/configuracoes',
    rotulo: 'Configurações',
    icone: 'settings',
    admin: true,
    filhos: [
      { rota: '/cms', rotulo: 'Site / Quartos', icone: 'web' },
      { rota: '/estabelecimento', rotulo: 'Pousada / Hotel', icone: 'home' },
      { rota: '/funcionarios', rotulo: 'Administrador', icone: 'lock_open' },
      { rota: '/integracoes', rotulo: 'Integrações', icone: 'cable' },
      { rota: '/auditoria', rotulo: 'Auditoria', icone: 'fact_check' },
    ],
  },
];

@Directive()
export abstract class ShellStore implements OnInit, OnDestroy {
  protected readonly auth = inject(AuthStore);
  protected readonly rt = inject(Realtime);
  protected readonly notifs = inject(Notificacoes);
  private readonly router = inject(Router);
  protected readonly aberta = signal(window.innerWidth > 768);

  /** Itens visíveis — filtra por permissão. */
  protected readonly nav = computed(() => NAV.filter((i) => !i.admin || this.auth.isAdmin()));

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
    const iniciais = (
      (partes[0]?.[0] ?? '') + (partes.length > 1 ? partes[partes.length - 1][0] : '')
    ).toUpperCase();
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

  constructor() {
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
    const prefixoDeIrmao = !!pai.filhos?.some(
      (f) => f !== filho && f.rota.startsWith(filho.rota + '/'),
    );
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
      setTimeout(
        () => grupo.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
        ANIMACAO_GRUPO_MS,
      );
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
