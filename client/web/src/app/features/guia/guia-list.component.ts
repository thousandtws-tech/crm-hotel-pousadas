import { Component, inject, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { BlogService } from '../../core/services/blog.service';
import { SeoService } from '../../core/services/seo.service';
import { IconComponent } from '../../shared/components/icons/icon.component';

@Component({
  selector: 'app-guia-list',
  imports: [RouterLink, IconComponent, DatePipe],
  template: `
    <!-- Header Hero -->
    <header class="relative pt-28 pb-12 sm:pt-32 sm:pb-14 lg:pt-36 lg:pb-16 bg-[#032B38] text-white overflow-hidden">
      <div class="absolute inset-0 z-0">
        <img
          src="https://images.unsplash.com/photo-1505142468610-359e7d316be0?auto=format&fit=crop&w=2200&q=85"
          alt="Guia do Peró e Cabo Frio — Pousada Espírito do Mar"
          class="w-full h-full object-cover object-center filter brightness-[0.5]"
        />
        <div class="absolute inset-0 bg-gradient-to-t from-[#032B38] via-[#032B38]/50 to-transparent"></div>
      </div>

      <div class="relative z-10 container-editorial text-center flex flex-col items-center">
        <h1 class="font-serif text-4xl sm:text-6xl text-white font-normal mb-3 sm:mb-4 leading-tight">
          Guia do Peró &amp; Cabo Frio
        </h1>
        <p class="text-sm sm:text-base text-[#F7F5F0]/80 font-light max-w-xl leading-relaxed">
          Dicas de praias, passeios, gastronomia e planejamento para aproveitar a Região dos Lagos como um local.
        </p>
      </div>
    </header>

    <!-- Posts Grid -->
    <section class="py-14 sm:py-18 lg:py-20 bg-[#F7F5F0]" aria-label="Artigos do guia">
      <div class="container-editorial">
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
          @for (post of blog.posts(); track post.slug) {
            <article class="group flex flex-col bg-white border border-[#DCE6EA] rounded-xl overflow-hidden shadow-[0_6px_24px_rgba(5,64,84,0.05)] hover:shadow-[0_16px_44px_rgba(5,64,84,0.12)] transition-shadow">
              <a [routerLink]="['/guia', post.slug]" class="block aspect-[16/10] relative overflow-hidden">
                <img
                  [src]="post.imagem"
                  [alt]="post.imagemAlt"
                  loading="lazy"
                  class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
                <span class="absolute top-4 left-4 z-10 inline-flex items-center bg-[#DDA554] text-[#032B38] text-[10px] font-semibold uppercase tracking-[0.12em] px-3 py-1.5 rounded-full">
                  {{ post.categoria }}
                </span>
              </a>

              <div class="flex flex-col flex-1 p-5 sm:p-6">
                <span class="text-[10px] uppercase tracking-[0.14em] text-[#536B73] mb-2">
                  {{ post.data | date: 'dd/MM/yyyy' }} · {{ post.tempoLeitura }} de leitura
                </span>
                <h2 class="font-serif text-2xl text-[#054054] group-hover:text-[#DDA554] transition-colors mb-2 leading-snug">
                  <a [routerLink]="['/guia', post.slug]">
                    {{ post.titulo }}
                  </a>
                </h2>
                <p class="type-body text-xs sm:text-sm line-clamp-3 mb-5 text-[#536B73]">
                  {{ post.resumo }}
                </p>
                <a [routerLink]="['/guia', post.slug]" class="btn-text self-start mt-auto">
                  <span>Ler o guia completo</span>
                  <app-icon name="arrow-right" [size]="13"></app-icon>
                </a>
              </div>
            </article>
          }
        </div>
      </div>
    </section>
  `,
})
export class GuiaListComponent implements OnInit {
  public readonly blog = inject(BlogService);
  private readonly seo = inject(SeoService);

  public ngOnInit(): void {
    this.seo.updateSeo({
      title: 'Guia do Peró e Cabo Frio | Pousada Espírito do Mar',
      description:
        'Dicas de praias, passeios e planejamento em Cabo Frio e na Região dos Lagos: Praia do Peró, gastronomia, melhor época para visitar.',
      url: 'https://espiritodomar.com.br/guia',
    });
  }
}
