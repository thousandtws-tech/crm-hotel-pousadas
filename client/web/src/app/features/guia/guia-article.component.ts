import { Component, inject, OnInit, signal, computed } from '@angular/core';
import { DOCUMENT, DatePipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { BlogService, BlogPost } from '../../core/services/blog.service';
import { SeoService } from '../../core/services/seo.service';
import { IconComponent } from '../../shared/components/icons/icon.component';
import { HOTEL_CONFIG } from '../../core/config/hotel-config';

@Component({
  selector: 'app-guia-article',
  imports: [RouterLink, IconComponent, DatePipe],
  template: `
    @if (post(); as p) {
      <!-- Article Hero -->
      <header class="relative pt-28 pb-16 sm:pt-32 sm:pb-20 lg:pt-40 lg:pb-24 bg-[#032B38] text-white overflow-hidden">
        <div class="absolute inset-0 z-0">
          <img
            [src]="p.imagem"
            [alt]="p.imagemAlt"
            class="w-full h-full object-cover object-center filter brightness-[0.45]"
          />
          <div class="absolute inset-0 bg-gradient-to-t from-[#032B38] via-[#032B38]/60 to-[#032B38]/20"></div>
        </div>

        <div class="relative z-10 container-editorial max-w-3xl mx-auto text-center flex flex-col items-center">
          <span class="inline-flex items-center bg-[#DDA554] text-[#032B38] text-[10px] font-semibold uppercase tracking-[0.12em] px-3 py-1.5 rounded-full mb-4">
            {{ p.categoria }}
          </span>
          <h1 class="font-serif text-3xl sm:text-5xl text-white font-normal leading-tight mb-4">
            {{ p.titulo }}
          </h1>
          <p class="text-xs uppercase tracking-[0.14em] text-white/70">
            {{ p.data | date: 'dd/MM/yyyy' }} · {{ p.tempoLeitura }} de leitura
          </p>
        </div>
      </header>

      <!-- Article Body -->
      <article class="py-14 sm:py-18 lg:py-20 bg-[#F7F5F0]">
        <div class="container-editorial">
          <div class="max-w-3xl mx-auto">

            <p class="font-serif text-xl sm:text-2xl text-[#054054] italic leading-relaxed mb-10 sm:mb-12">
              {{ p.resumo }}
            </p>

            @for (sec of p.secoes; track sec.titulo) {
              <section class="mb-9 sm:mb-10">
                <h2 class="font-serif text-2xl sm:text-3xl text-[#054054] mb-4">{{ sec.titulo }}</h2>
                @for (par of sec.paragrafos; track par) {
                  <p class="type-body text-base mb-4">{{ par }}</p>
                }
              </section>
            }

            <!-- CTA -->
            <div class="mt-12 bg-[#032B38] rounded-xl p-7 sm:p-10 text-center">
              <h2 class="font-serif text-2xl sm:text-3xl text-white mb-3">
                Hospede-se perto da Praia do Peró
              </h2>
              <p class="text-sm text-white/75 font-light max-w-md mx-auto mb-6">
                Quartos climatizados, piscina e café da manhã — consulte a disponibilidade para as datas da sua viagem.
              </p>
              <div class="flex flex-wrap items-center justify-center gap-4">
                <a routerLink="/reservar" class="btn-secondary-light">
                  <span>Consultar disponibilidade</span>
                  <app-icon name="arrow-right" [size]="13" class="text-white"></app-icon>
                </a>
                <a routerLink="/acomodacoes" class="text-xs uppercase tracking-[0.16em] text-white/85 hover:text-[#DDA554] transition-colors underline underline-offset-8 decoration-white/30">
                  Ver acomodações
                </a>
              </div>
            </div>

            <!-- Related -->
            @if (relacionados().length) {
              <div class="mt-14">
                <h2 class="font-serif text-2xl text-[#054054] mb-6">Continue explorando o guia</h2>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  @for (rel of relacionados(); track rel.slug) {
                    <a [routerLink]="['/guia', rel.slug]" class="group flex gap-4 bg-white border border-[#DCE6EA] rounded-xl p-4 hover:shadow-[0_10px_30px_rgba(5,64,84,0.10)] transition-shadow">
                      <div class="w-20 h-20 shrink-0 rounded-lg overflow-hidden">
                        <img [src]="rel.imagem" [alt]="rel.imagemAlt" loading="lazy" class="w-full h-full object-cover" />
                      </div>
                      <div class="min-w-0">
                        <span class="text-[10px] uppercase tracking-[0.12em] text-[#DDA554] block mb-1">{{ rel.categoria }}</span>
                        <span class="font-serif text-base text-[#054054] group-hover:text-[#DDA554] transition-colors leading-snug line-clamp-2">{{ rel.titulo }}</span>
                      </div>
                    </a>
                  }
                </div>
              </div>
            }

          </div>
        </div>
      </article>
    } @else {
      <section class="py-44 text-center bg-[#F7F5F0]">
        <div class="max-w-md mx-auto px-6">
          <h1 class="font-serif text-3xl text-[#054054] mb-4">Artigo não encontrado</h1>
          <p class="type-body mb-8">O conteúdo solicitado não está disponível.</p>
          <a routerLink="/guia" class="btn-primary">Voltar ao guia</a>
        </div>
      </section>
    }
  `,
})
export class GuiaArticleComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly blog = inject(BlogService);
  private readonly seo = inject(SeoService);
  private readonly doc = inject(DOCUMENT);

  private readonly slug = signal<string | null>(null);
  public readonly post = computed<BlogPost | undefined>(() => {
    const s = this.slug();
    return s ? this.blog.getBySlug(s) : undefined;
  });
  public readonly relacionados = computed(() => {
    const s = this.slug();
    return s ? this.blog.relacionados(s) : [];
  });

  public ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const slug = params.get('slug');
      this.slug.set(slug);
      const p = slug ? this.blog.getBySlug(slug) : undefined;
      if (p) {
        this.seo.updateSeo({
          title: `${p.titulo} | Pousada Espírito do Mar`,
          description: p.resumo,
          keywords: p.keywords,
          image: p.imagem,
          url: `${HOTEL_CONFIG.siteUrl}/guia/${p.slug}`,
        });
        this.injectJsonLd(p);
      }
    });
  }

  private injectJsonLd(p: BlogPost): void {
    const id = 'guia-article-jsonld';
    this.doc.getElementById(id)?.remove();
    const script = this.doc.createElement('script');
    script.id = id;
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: p.titulo,
      description: p.resumo,
      image: p.imagem,
      datePublished: p.data,
      author: { '@type': 'Organization', name: 'Pousada Espírito do Mar' },
      publisher: { '@type': 'Organization', name: 'Pousada Espírito do Mar' },
      mainEntityOfPage: `${HOTEL_CONFIG.siteUrl}/guia/${p.slug}`,
    });
    this.doc.head.appendChild(script);
  }
}
