import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Socket, Channel } from 'phoenix';
import { environment } from '../../../environments/environment';

export interface HeroContent {
  titulo: string;
  subtitulo: string;
}

export interface SeoContent {
  titulo: string;
  descricao: string;
  keywords: string;
}

export interface FaqItem {
  pergunta: string;
  resposta: string;
}

export type CmsDados = Record<string, unknown>;

interface CmsSecaoApi {
  secao: string;
  dados: CmsDados;
  visivel: boolean;
}

export interface SiteMidiaMeta {
  id: number;
  tipo: 'foto' | 'video';
  nome: string;
  mime: string;
}

const API = environment.apiUrl;

/** String de uma chave; '' quando ausente ou de outro tipo. */
export function cmsStr(dados: CmsDados | null | undefined, key: string): string {
  const v = dados?.[key];
  return typeof v === 'string' ? v : '';
}

/** Lista de objetos de uma chave; [] quando ausente. */
export function cmsLista(dados: CmsDados | null | undefined, key: string): CmsDados[] {
  const v = dados?.[key];
  return Array.isArray(v)
    ? v.filter((i): i is CmsDados => typeof i === 'object' && i !== null)
    : [];
}

@Injectable({ providedIn: 'root' })
export class SiteContentService {
  private readonly platformId = inject(PLATFORM_ID);
  private socket: Socket | null = null;
  private canal: Channel | null = null;
  private refetchTimer: ReturnType<typeof setTimeout> | null = null;

  /** Todas as seções visíveis indexadas por chave (`hero`, `sobre.header`…). */
  public readonly secoes = signal<Record<string, CmsDados>>({});

  /** Metadados da biblioteca pública indexados por id. */
  public readonly midias = signal<Record<number, SiteMidiaMeta>>({});

  public readonly hero = computed<HeroContent | null>(() => {
    const d = this.secoes()['hero'];
    return d ? { titulo: cmsStr(d, 'titulo'), subtitulo: cmsStr(d, 'subtitulo') } : null;
  });

  public readonly seo = computed<SeoContent | null>(() => {
    const d = this.secoes()['seo'];
    return d
      ? { titulo: cmsStr(d, 'titulo'), descricao: cmsStr(d, 'descricao'), keywords: cmsStr(d, 'keywords') }
      : null;
  });

  public readonly faq = computed<FaqItem[]>(() =>
    cmsLista(this.secoes()['faq'], 'itens')
      .map((i) => ({ pergunta: cmsStr(i, 'pergunta'), resposta: cmsStr(i, 'resposta') }))
      .filter((i) => i.pergunta && i.resposta),
  );

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      void this.carregar();
      this.conectarStream();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void this.carregar();
      });
    }
  }

  /** Dados de uma seção (null quando inexistente/oculta — use fallback no componente). */
  public secao(nome: string): CmsDados | null {
    return this.secoes()[nome] ?? null;
  }

  /** SEO por página: `${pagina}.seo`, caindo para a seção `seo` global (home). */
  public seoPagina(pagina: string): SeoContent | null {
    const d = this.secoes()[`${pagina}.seo`] ?? this.secoes()['seo'];
    return d
      ? { titulo: cmsStr(d, 'titulo'), descricao: cmsStr(d, 'descricao'), keywords: cmsStr(d, 'keywords') }
      : null;
  }

  /** URL pública do binário de uma mídia da biblioteca (id guardado no CMS). */
  public midiaUrl(id: unknown): string {
    const n = Number(id);
    return Number.isFinite(n) && n > 0 ? `${API}/site-midia/${n}` : '';
  }

  /** Metadados de uma mídia (tipo foto/video) — null enquanto não carregado. */
  public midia(id: unknown): SiteMidiaMeta | null {
    const n = Number(id);
    return Number.isFinite(n) && n > 0 ? (this.midias()[n] ?? null) : null;
  }

  public async carregar(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      const [resSecoes, resMidias] = await Promise.all([
        fetch(`${API}/publico/cms/site`, { cache: 'no-store' }),
        fetch(`${API}/publico/site-midia`, { cache: 'no-store' }),
      ]);
      if (resSecoes.ok) {
        const secoes = (await resSecoes.json()) as CmsSecaoApi[];
        const mapa: Record<string, CmsDados> = {};
        for (const s of secoes) {
          if (!s.visivel || typeof s.dados !== 'object' || s.dados === null) continue;
          mapa[s.secao] = s.dados;
        }
        this.secoes.set(mapa);
      }
      if (resMidias.ok) {
        const lista = (await resMidias.json()) as SiteMidiaMeta[];
        const mapa: Record<number, SiteMidiaMeta> = {};
        for (const m of lista) mapa[m.id] = m;
        this.midias.set(mapa);
      }
    } catch {
      // API indisponível → o site segue com o conteúdo padrão dos componentes.
    }
  }

  private conectarStream(): void {
    try {
      const socket = new Socket(environment.realtimeUrl, {
        reconnectAfterMs: (t) => Math.min(1000 * 2 ** t, 15000),
      });
      this.socket = socket;
      socket.onOpen(() => void this.carregar());
      this.canal = socket.channel('site:deltas');
      this.canal.on('delta', () => this.agendarRefetch());
      this.canal.join();
      socket.connect();
    } catch {
      // Sem realtime → atualiza ao recarregar ou voltar à aba.
    }
  }

  private agendarRefetch(): void {
    if (this.refetchTimer) clearTimeout(this.refetchTimer);
    this.refetchTimer = setTimeout(() => void this.carregar(), 150);
  }
}
