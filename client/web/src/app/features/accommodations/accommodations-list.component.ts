import { Component, afterNextRender, ElementRef, inject, DestroyRef, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AccommodationService } from '../../core/services/accommodation.service';
import { SeoService } from '../../core/services/seo.service';
import { IconComponent } from '../../shared/components/icons/icon.component';
import { MotionService } from '../../core/services/motion.service';

@Component({
  selector: 'app-accommodations-list',
  imports: [RouterLink, IconComponent],
  template: `
    <!-- Header Hero -->
    <header class="suites-page-header relative pt-28 pb-12 sm:pt-32 sm:pb-14 lg:pt-36 lg:pb-16 bg-[#032B38] text-white overflow-hidden">
      <div class="absolute inset-0 z-0">
        <img
          src="https://images.unsplash.com/photo-1566665797739-1674de7a421a?auto=format&fit=crop&w=2200&q=85"
          alt="Acomodações da Pousada Espírito do Mar em Cabo Frio (imagem ilustrativa)"
          class="w-full h-full object-cover object-center filter brightness-[0.55]"
        />
        <div class="absolute inset-0 bg-gradient-to-t from-[#032B38] via-[#032B38]/50 to-transparent"></div>
      </div>

      <div class="relative z-10 container-editorial text-center flex flex-col items-center">
        <h1 class="font-serif text-4xl sm:text-6xl text-white font-normal mb-3 sm:mb-4 leading-tight">
          Nossas Acomodações
        </h1>
        <p class="text-sm sm:text-base text-[#F7F5F0]/80 font-light max-w-xl leading-relaxed">
          Quartos equipados com ar-condicionado, TV e banheiro privativo, com opções para casais, pequenas famílias e grupos no bairro Peró.
        </p>
      </div>
    </header>

    <!-- Accommodations List -->
    <section class="py-14 sm:py-18 lg:py-20 bg-[#F7F5F0]" aria-labelledby="suites-list-title">
      <div class="container-editorial">
        <h2 id="suites-list-title" class="sr-only">Lista de Acomodações</h2>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
          @for (acc of accommodationService.accommodations(); track acc.id) {
            <article class="suite-article group flex flex-col bg-white border border-[#DCE6EA] rounded-xl overflow-hidden shadow-[0_6px_24px_rgba(5,64,84,0.05)] hover:shadow-[0_16px_44px_rgba(5,64,84,0.12)] transition-shadow">

              <!-- Photo + rating badge -->
              <a [routerLink]="['/acomodacoes', acc.slug]" class="block editorial-image-container aspect-[4/3] relative">
                <img
                  [src]="acc.coverImage"
                  [alt]="acc.name + ' (imagem ilustrativa)'"
                  loading="lazy"
                  class="w-full h-full object-cover"
                />
                <span class="absolute top-4 right-4 z-10 inline-flex items-center gap-1.5 bg-[#032B38]/85 backdrop-blur-sm text-white text-xs font-medium px-3 py-1.5 rounded-full">
                  <app-icon name="star" [size]="12" class="text-[#DDA554]"></app-icon>
                  4,9
                </span>
              </a>

              <!-- Card body -->
              <div class="flex flex-col flex-1 p-5 sm:p-6">
                <span class="type-eyebrow text-[#DDA554] block mb-1.5">
                  {{ acc.view }} · Até {{ acc.guests }} hóspedes
                </span>

                <h3 class="font-serif text-2xl text-[#054054] group-hover:text-[#DDA554] transition-colors mb-1.5">
                  <a [routerLink]="['/acomodacoes', acc.slug]">
                    {{ acc.name }}
                  </a>
                </h3>

                <p class="type-body text-xs sm:text-sm line-clamp-2 mb-4 text-[#536B73]">
                  {{ acc.shortDescription || acc.subtitle }}
                </p>

                <!-- Meta row -->
                <div class="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-[#536B73] mb-5 pb-5 border-b border-[#DCE6EA]">
                  <span class="inline-flex items-center gap-1.5">
                    <app-icon name="users" [size]="13" class="text-[#054054]"></app-icon>
                    {{ acc.beds }}
                  </span>
                  <span class="inline-flex items-center gap-1.5">
                    <app-icon name="wind" [size]="13" class="text-[#054054]"></app-icon>
                    Ar-condicionado
                  </span>
                  <span class="inline-flex items-center gap-1.5">
                    <app-icon name="bath" [size]="13" class="text-[#054054]"></app-icon>
                    Banheiro privativo
                  </span>
                </div>

                <!-- Price + CTA -->
                <div class="flex items-center justify-between gap-4 mt-auto">
                  <div class="flex flex-col">
                    <span class="type-caption text-[#536B73] text-[10px]">A partir de</span>
                    <span class="font-serif text-xl text-[#054054]">
                      {{ acc.priceLabel }}<span class="text-xs text-[#536B73] font-normal">/noite</span>
                    </span>
                  </div>
                  <a
                    [routerLink]="['/acomodacoes', acc.slug]"
                    class="btn-secondary !px-4 !py-2.5 text-xs shrink-0"
                  >
                    <span>Ver detalhes</span>
                    <app-icon name="arrow-right" [size]="12"></app-icon>
                  </a>
                </div>
              </div>

            </article>
          }
        </div>

      </div>
    </section>
  `
})
export class AccommodationsListComponent implements OnInit {
  public readonly accommodationService = inject(AccommodationService);
  private readonly seoService = inject(SeoService);
  private readonly el = inject(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly motion = inject(MotionService);

  constructor() {
    afterNextRender(() => {
      this.initAnimations();
    });
  }

  public ngOnInit(): void {
    this.seoService.updateSeo({
      title: 'Acomodações | Pousada Espírito do Mar no Peró, Cabo Frio',
      description: 'Conheça as acomodações da Pousada Espírito do Mar, no Peró, Cabo Frio: quartos duplos, triplos (incluindo unidades com varanda) e quádruplos com ar-condicionado e TV.',
      url: 'https://pousadaespiritodomar.com.br/acomodacoes'
    });
  }

  private initAnimations(): void {
    const root = this.el.nativeElement as HTMLElement;
    this.motion.createScope(root, () => {
      const header = root.querySelector<HTMLElement>('.suites-page-header');
      const articles = root.querySelectorAll<HTMLElement>('.suite-article');

      if (header) {
        this.motion.animateScrollReveal(header, { y: 28, duration: 0.85 });
      }

      articles.forEach((art) => {
        this.motion.animateScrollReveal(art, { y: 32, duration: 0.9, trigger: art });
      });
    }, this.destroyRef);
  }
}
