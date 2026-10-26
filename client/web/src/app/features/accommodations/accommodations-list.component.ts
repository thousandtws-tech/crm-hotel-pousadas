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
        <span class="type-eyebrow text-[#DDA554] block mb-2 sm:mb-3">
          Hospedagem no Peró · Cabo Frio
        </span>
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

        <div class="space-y-12 sm:space-y-16 lg:space-y-20">
          @for (acc of accommodationService.accommodations(); track acc.id; let idx = $index) {
            <article class="suite-article grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
              
              <!-- Large Photo -->
              <div
                class="lg:col-span-7 editorial-image-container aspect-[16/10] shadow-sm group"
                [class.lg:order-2]="idx % 2 === 1"
              >
                <a [routerLink]="['/acomodacoes', acc.slug]" class="block w-full h-full">
                  <img
                    [src]="acc.coverImage"
                    [alt]="acc.name + ' (imagem ilustrativa)'"
                    loading="lazy"
                    class="w-full h-full object-cover"
                  />
                </a>
              </div>

              <!-- Information Column -->
              <div
                class="lg:col-span-5 flex flex-col items-start"
                [class.lg:order-1]="idx % 2 === 1"
              >
                <span class="type-eyebrow text-[#DDA554] block mb-2">
                  {{ acc.view }}
                </span>

                <h3 class="font-serif text-3xl sm:text-4xl text-[#054054] mb-3">
                  <a [routerLink]="['/acomodacoes', acc.slug]" class="hover:text-[#DDA554] transition-colors">
                    {{ acc.name }}
                  </a>
                </h3>

                <p class="font-serif italic text-base text-[#536B73] mb-5">
                  "{{ acc.subtitle }}"
                </p>

                <p class="type-body text-sm sm:text-base mb-6">
                  {{ acc.description }}
                </p>

                <!-- Spec Line -->
                <div class="w-full flex flex-wrap items-center justify-between gap-2 py-3 border-y border-[#DCE6EA] mb-6 text-xs text-[#536B73]">
                  <span>{{ acc.beds }}</span>
                  <span>·</span>
                  <span>Até {{ acc.guests }} hóspedes</span>
                </div>

                <!-- Price Label and Link -->
                <div class="flex items-center justify-between w-full pt-2">
                  <div>
                    <span class="type-caption block text-[#536B73]">Tarifas e disponibilidade</span>
                    <span class="font-serif text-2xl text-[#054054]">
                      {{ acc.priceLabel }}
                    </span>
                  </div>

                  <a
                    [routerLink]="['/acomodacoes', acc.slug]"
                    class="btn-primary"
                  >
                    <span>Consultar categoria</span>
                    <app-icon name="arrow-right" [size]="13"></app-icon>
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
