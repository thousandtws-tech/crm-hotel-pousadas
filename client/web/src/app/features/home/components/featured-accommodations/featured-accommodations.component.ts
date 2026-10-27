import { Component, afterNextRender, ElementRef, inject, DestroyRef } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AccommodationService } from '../../../../core/services/accommodation.service';
import { IconComponent } from '../../../../shared/components/icons/icon.component';
import { MotionService } from '../../../../core/services/motion.service';

@Component({
  selector: 'app-featured-accommodations',
  imports: [RouterLink, IconComponent],
  template: `
    <section class="py-16 sm:py-20 lg:py-24 bg-[#EEF3F5]" aria-labelledby="accommodations-heading">
      <div class="container-editorial">
        
        <!-- Section Header -->
        <div class="suites-header flex flex-col items-center text-center mb-8 sm:mb-10 lg:mb-12 gap-4">
          <h2 id="accommodations-heading" class="type-title text-[#054054] max-w-2xl">
            Quartos pensados para o seu descanso em Cabo Frio.
          </h2>

          <a
            routerLink="/acomodacoes"
            class="btn-text"
          >
            <span>Conheça nossas acomodações</span>
            <app-icon name="arrow-right" [size]="13"></app-icon>
          </a>
        </div>

        <!-- Editorial Accommodation Layout -->
        <div class="space-y-12 sm:space-y-14 lg:space-y-16">
          
          <!-- Primary Featured Room -->
          @if (accommodationService.accommodations()[0]; as master) {
            <article class="master-suite-article group">
              <a [routerLink]="['/acomodacoes', master.slug]" class="master-img-wrap block parallax-container aspect-[16/10] lg:aspect-[21/9] mb-5 sm:mb-6">
                <img
                  [src]="master.coverImage"
                  [alt]="master.name + ' na Pousada Espírito do Mar (imagem ilustrativa)'"
                  loading="lazy"
                  class="master-img parallax-image w-full h-full object-cover"
                />
              </a>

              <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-baseline">
                <div class="lg:col-span-5">
                  <span class="type-caption block mb-1 text-[#DDA554]">{{ master.floor }}</span>
                  <h3 class="font-serif text-3xl sm:text-4xl text-[#054054] group-hover:text-[#DDA554] transition-colors">
                    <a [routerLink]="['/acomodacoes', master.slug]">
                      {{ master.name }}
                    </a>
                  </h3>
                </div>

                <div class="lg:col-span-4 type-body text-sm sm:text-base text-[#536B73]">
                  <p>{{ master.shortDescription }}</p>
                  <div class="flex flex-wrap items-center gap-3 text-xs text-[#536B73] mt-3">
                    <span>Ar-condicionado e TV</span>
                    <span>·</span>
                    <span>Banheiro privativo</span>
                    <span>·</span>
                    <span>Até {{ master.guests }} hóspedes</span>
                  </div>
                </div>

                <div class="lg:col-span-3 lg:text-right flex flex-col lg:items-end justify-between self-stretch">
                  <div>
                    <span class="type-caption block text-[#536B73]">Tarifas e datas</span>
                    <span class="font-serif text-2xl text-[#054054]">
                      {{ master.priceLabel }}
                    </span>
                  </div>

                  <a [routerLink]="['/acomodacoes', master.slug]" class="btn-text mt-4 lg:mt-0">
                    <span>Consultar categoria</span>
                    <app-icon name="arrow-right" [size]="13"></app-icon>
                  </a>
                </div>
              </div>
            </article>
          }

          <!-- Secondary Rooms in Clean Asymmetric 2-Column -->
          <div class="secondary-suites-grid grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8 lg:gap-10">
            @for (acc of secondarySuites(); track acc.id) {
              <article class="suite-card group">
                <a [routerLink]="['/acomodacoes', acc.slug]" class="block editorial-image-container aspect-[4/3] mb-4">
                  <img
                    [src]="acc.coverImage"
                    [alt]="acc.name + ' na Pousada Espírito do Mar (imagem ilustrativa)'"
                    loading="lazy"
                    class="w-full h-full object-cover"
                  />
                </a>

                <div class="flex flex-col">
                  <span class="type-caption block mb-1 text-[#DDA554]">{{ acc.view }} · Até {{ acc.guests }} hóspedes</span>
                  <div class="flex items-baseline justify-between gap-4 mb-2">
                    <h3 class="font-serif text-2xl text-[#054054] group-hover:text-[#DDA554] transition-colors">
                      <a [routerLink]="['/acomodacoes', acc.slug]">
                        {{ acc.name }}
                      </a>
                    </h3>
                    <span class="font-serif text-base text-[#054054] whitespace-nowrap">
                      {{ acc.priceLabel }}
                    </span>
                  </div>

                  <p class="type-body text-xs sm:text-sm line-clamp-2 mb-4 text-[#536B73]">
                    {{ acc.shortDescription }}
                  </p>

                  <a [routerLink]="['/acomodacoes', acc.slug]" class="btn-text self-start">
                    <span>Detalhes da acomodação</span>
                    <app-icon name="arrow-right" [size]="13"></app-icon>
                  </a>
                </div>
              </article>
            }
          </div>

        </div>

      </div>
    </section>
  `
})
export class FeaturedAccommodationsComponent {
  public readonly accommodationService = inject(AccommodationService);
  private readonly el = inject(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly motion = inject(MotionService);

  constructor() {
    afterNextRender(() => {
      this.initAnimations();
    });
  }

  public secondarySuites() {
    return this.accommodationService.accommodations().slice(1, 3);
  }

  private initAnimations(): void {
    const root = this.el.nativeElement as HTMLElement;
    this.motion.createScope(root, () => {
      const header = root.querySelector<HTMLElement>('.suites-header');
      const masterArticle = root.querySelector<HTMLElement>('.master-suite-article');
      const masterImgWrap = root.querySelector<HTMLElement>('.master-img-wrap');
      const masterImg = root.querySelector<HTMLElement>('.master-img');
      const cards = root.querySelectorAll<HTMLElement>('.suite-card');

      if (header) {
        this.motion.animateScrollReveal(header, { y: 28, duration: 0.85 });
      }

      if (masterArticle) {
        this.motion.animateScrollReveal(masterArticle, { y: 32, duration: 0.9, trigger: masterArticle });
      }

      if (masterImg && masterImgWrap) {
        this.motion.animateParallax(masterImg, masterImgWrap, { yPercent: 6, scrub: 0.5 });
      }

      if (cards.length > 0) {
        const grid = root.querySelector<HTMLElement>('.secondary-suites-grid');
        this.motion.animateScrollReveal(Array.from(cards), {
          y: 28,
          duration: 0.85,
          stagger: 0.12,
          trigger: grid || cards[0]
        });
      }
    }, this.destroyRef);
  }
}
