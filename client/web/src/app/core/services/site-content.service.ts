import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
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

interface CmsSecaoApi {
  secao: string;
  dados: Record<string, unknown>;
  visivel: boolean;
}

const API = environment.apiUrl;

function str(dados: Record<string, unknown>, key: string): string {
  const v = dados[key];
  return typeof v === 'string' ? v : '';
}

@Injectable({ providedIn: 'root' })
export class SiteContentService {
  private readonly platformId = inject(PLATFORM_ID);
  private socket: Socket | null = null;
  private canal: Channel | null = null;
  private refetchTimer: ReturnType<typeof setTimeout> | null = null;

  public readonly hero = signal<HeroContent | null>(null);
  public readonly seo = signal<SeoContent | null>(null);
  public readonly faq = signal<FaqItem[]>([]);

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      void this.carregar();
      this.conectarStream();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void this.carregar();
      });
    }
  }

  public async carregar(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      const res = await fetch(`${API}/publico/cms/site`, { cache: 'no-store' });
      if (!res.ok) return;
      const secoes = (await res.json()) as CmsSecaoApi[];
      let novoHero: HeroContent | null = null;
      let novoSeo: SeoContent | null = null;
      let novoFaq: FaqItem[] = [];

      for (const s of secoes) {
        if (!s.visivel || typeof s.dados !== 'object' || s.dados === null) continue;
        if (s.secao === 'hero') {
          novoHero = {
            titulo: str(s.dados, 'titulo'),
            subtitulo: str(s.dados, 'subtitulo'),
          };
        } else if (s.secao === 'seo') {
          novoSeo = {
            titulo: str(s.dados, 'titulo'),
            descricao: str(s.dados, 'descricao'),
            keywords: str(s.dados, 'keywords'),
          };
        } else if (s.secao === 'faq') {
          const itens = s.dados['itens'];
          if (Array.isArray(itens)) {
            novoFaq = itens
              .filter((i): i is Record<string, unknown> => typeof i === 'object' && i !== null)
              .map((i) => ({ pergunta: str(i, 'pergunta'), resposta: str(i, 'resposta') }))
              .filter((i) => i.pergunta && i.resposta);
          }
        }
      }

      this.hero.set(novoHero);
      this.seo.set(novoSeo);
      this.faq.set(novoFaq);
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
