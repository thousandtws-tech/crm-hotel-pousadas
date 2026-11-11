import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

/**
 * Seções editáveis do site institucional (`cms_site` no backend).
 * Cada seção chega como objeto livre — campos ausentes mantêm o
 * conteúdo padrão hardcoded dos componentes.
 */

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
  private readonly http = inject(HttpClient);

  public readonly hero = signal<HeroContent | null>(null);
  public readonly seo = signal<SeoContent | null>(null);
  public readonly faq = signal<FaqItem[]>([]);

  /** Busca e popula as seções — idempotente (ignora chamadas repetidas). */
  public carregar(): void {
    if (this.hero() !== null || this.seo() !== null || this.faq().length) return;
    this.http.get<CmsSecaoApi[]>(`${API}/publico/cms/site`).subscribe({
      next: (secoes) => {
        for (const s of secoes) {
          if (s.secao === 'hero') {
            this.hero.set({
              titulo: str(s.dados, 'titulo'),
              subtitulo: str(s.dados, 'subtitulo'),
            });
          } else if (s.secao === 'seo') {
            this.seo.set({
              titulo: str(s.dados, 'titulo'),
              descricao: str(s.dados, 'descricao'),
              keywords: str(s.dados, 'keywords'),
            });
          } else if (s.secao === 'faq') {
            const itens = s.dados['itens'];
            if (Array.isArray(itens)) {
              this.faq.set(
                itens
                  .filter((i): i is Record<string, unknown> => typeof i === 'object' && i !== null)
                  .map((i) => ({ pergunta: str(i, 'pergunta'), resposta: str(i, 'resposta') }))
                  .filter((i) => i.pergunta && i.resposta),
              );
            }
          }
        }
      },
      error: () => {
        // API indisponível → o site segue com o conteúdo padrão dos componentes.
      },
    });
  }
}
