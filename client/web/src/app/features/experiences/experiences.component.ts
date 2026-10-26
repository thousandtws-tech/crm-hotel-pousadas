import { Component, afterNextRender, ElementRef, inject, DestroyRef, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ExperienceService } from '../../core/services/experience.service';
import { SeoService } from '../../core/services/seo.service';
import { IconComponent } from '../../shared/components/icons/icon.component';
import { HOTEL_CONFIG } from '../../core/config/hotel-config';
import { MotionService } from '../../core/services/motion.service';

@Component({
  selector: 'app-experiences',
  imports: [RouterLink, IconComponent],
  template: `
    <!-- Header Hero -->
    <header class="exp-page-header relative pt-28 pb-12 sm:pt-32 sm:pb-14 lg:pt-36 lg:pb-16 bg-[#032B38] text-white overflow-hidden">
      <div class="absolute inset-0 z-0">
        <img
          src="https://images.unsplash.com/photo-1576013551627-0cc20b96c2a7?auto=format&fit=crop&w=2200&q=85"
          alt="Estrutura e comodidades na Pousada Espírito do Mar (imagem ilustrativa)"
          class="w-full h-full object-cover object-center filter brightness-[0.5]"
        />
        <div class="absolute inset-0 bg-gradient-to-t from-[#032B38] via-[#032B38]/50 to-transparent"></div>
      </div>

      <div class="relative z-10 container-editorial text-center flex flex-col items-center">
        <span class="type-eyebrow text-[#DDA554] block mb-2 sm:mb-3">
          Pousada no Peró · Cabo Frio
        </span>
        <h1 class="font-serif text-4xl sm:text-6xl text-white font-normal mb-3 sm:mb-4 leading-tight">
          Estrutura & Comodidades
        </h1>
        <p class="text-sm sm:text-base text-[#F7F5F0]/80 font-light max-w-xl leading-relaxed">
          Piscina externa, café da manhã, Wi-Fi, estacionamento e fácil acesso à Praia do Peró para seus dias em Cabo Frio.
        </p>
      </div>
    </header>

    <!-- Experiences / Structure List -->
    <section class="py-14 sm:py-18 lg:py-20 bg-[#F7F5F0]" aria-labelledby="all-experiences-title">
      <div class="container-editorial">
        <h2 id="all-experiences-title" class="sr-only">Estrutura e Comodidades da Pousada</h2>

        <div class="space-y-12 sm:space-y-16 lg:space-y-20">
          @for (exp of experienceService.experiences(); track exp.id; let idx = $index) {
            <article class="exp-article grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
              
              <!-- Large Photo -->
              <div
                class="lg:col-span-7 editorial-image-container aspect-[16/10] shadow-sm group"
                [class.lg:order-2]="idx % 2 === 1"
              >
                <img
                  [src]="exp.image"
                  [alt]="exp.title + ' (imagem ilustrativa)'"
                  loading="lazy"
                  class="w-full h-full object-cover"
                />
              </div>

              <!-- Information Column -->
              <div
                class="lg:col-span-5 flex flex-col items-start"
                [class.lg:order-1]="idx % 2 === 1"
              >
                <span class="type-eyebrow text-[#DDA554] block mb-2">
                  {{ exp.category }}
                </span>

                <h3 class="font-serif text-3xl sm:text-4xl text-[#054054] mb-3">
                  {{ exp.title }}
                </h3>

                <p class="font-serif italic text-base text-[#536B73] mb-5">
                  "{{ exp.tagline }}"
                </p>

                <p class="type-body text-sm sm:text-base mb-4">
                  {{ exp.description }}
                </p>

                @if (exp.longDescription) {
                  <p class="type-body text-sm sm:text-base mb-6">
                    {{ exp.longDescription }}
                  </p>
                }

                @if (exp.schedule) {
                  <span class="type-caption block text-[#054054] font-medium mb-6">
                    Observação: {{ exp.schedule }}
                  </span>
                }

                <a
                  routerLink="/reservar"
                  class="btn-secondary"
                >
                  <span>Consultar disponibilidade</span>
                  <app-icon name="arrow-right" [size]="13"></app-icon>
                </a>

              </div>

            </article>
          }
        </div>

      </div>
    </section>
  `
})
export class ExperiencesComponent implements OnInit {
  public readonly experienceService = inject(ExperienceService);
  public readonly hotelConfig = HOTEL_CONFIG;
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
      title: 'Estrutura & Comodidades | Pousada Espírito do Mar, Cabo Frio',
      description: 'Conheça a estrutura da Pousada Espírito do Mar no Peró, Cabo Frio: piscina externa, café da manhã, Wi-Fi, estacionamento e quartos climatizados.',
      url: 'https://pousadaespiritodomar.com.br/experiencias'
    });
  }

  private initAnimations(): void {
    const root = this.el.nativeElement as HTMLElement;
    this.motion.createScope(root, () => {
      const header = root.querySelector<HTMLElement>('.exp-page-header');
      const articles = root.querySelectorAll<HTMLElement>('.exp-article');

      if (header) {
        this.motion.animateScrollReveal(header, { y: 28, duration: 0.85 });
      }

      articles.forEach((art) => {
        this.motion.animateScrollReveal(art, { y: 32, duration: 0.9, trigger: art });
      });
    }, this.destroyRef);
  }
}
