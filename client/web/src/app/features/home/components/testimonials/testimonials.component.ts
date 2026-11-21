import { Component, DestroyRef, ElementRef, afterNextRender, inject } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { HOTEL_CONFIG } from '../../../../core/config/hotel-config';
import { IconComponent } from '../../../../shared/components/icons/icon.component';
import { MotionService } from '../../../../core/services/motion.service';

@Component({
  selector: 'app-testimonials',
  imports: [IconComponent],
  template: `
    <section
      class="testimonials-section py-14 sm:py-18 lg:py-20 bg-[#EEF3F5] border-t border-[#DCE6EA]"
      aria-labelledby="testimonials-heading"
    >
      <div class="container-editorial">
        <div class="testimonials-block max-w-5xl mx-auto">
          <div class="text-center max-w-3xl mx-auto mb-8 sm:mb-10">
            <span class="type-eyebrow text-[#8A5A1E] block mb-3 sm:mb-4">
              Avaliações Públicas · Google Maps
            </span>

            <h2 id="testimonials-heading" class="type-title text-[#054054] mb-4">
              O que dizem os viajantes sobre a pousada
            </h2>

            <p class="type-body text-[#536B73]">
              Prezamos pela transparência e autenticidade. Consulte o pino oficial da Pousada Espírito do Mar no Google Maps para visualizar avaliações públicas verificadas, fotos enviadas por hóspedes e localização no bairro Peró.
            </p>
          </div>

          <div class="bg-white border border-[#DCE6EA] shadow-raised p-3 sm:p-5 mb-8">
            <div class="relative w-full h-[340px] sm:h-[400px] overflow-hidden bg-[#F7F5F0]">
              <iframe
                [src]="safeMapEmbedUrl"
                title="Localização e avaliações da Pousada Espírito do Mar no Google Maps"
                class="w-full h-full border-0"
                loading="lazy"
                referrerpolicy="no-referrer-when-downgrade"
                allowfullscreen
              ></iframe>
            </div>

            <div class="pt-4 px-1 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t border-[#DCE6EA] mt-4">
              <div class="flex items-center gap-2.5 text-left">
                <app-icon name="map-pin" [size]="16" class="text-[#1A6F8A] shrink-0"></app-icon>
                <span class="type-caption text-[#054054] font-medium">
                  {{ hotelConfig.businessName }} · {{ hotelConfig.address.fullFormatted }}
                </span>
              </div>
              <span class="type-caption text-[#536B73]">
                Clique em "Ampliar o mapa" no card do Google para ler todas as avaliações
              </span>
            </div>
          </div>

          <div class="flex flex-wrap items-center justify-center gap-4">
            <a
              [href]="hotelConfig.googleSearchReviewsUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="btn-primary"
            >
              <span>Ver avaliações no Google</span>
              <app-icon name="arrow-right" [size]="13"></app-icon>
            </a>

            <a
              [href]="hotelConfig.googleHotelsUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="btn-secondary"
            >
              <span>Perfil no Google Hotéis</span>
            </a>
          </div>
        </div>
      </div>
    </section>
  `
})
export class TestimonialsComponent {
  public readonly hotelConfig = HOTEL_CONFIG;
  public readonly safeMapEmbedUrl: SafeResourceUrl;

  private readonly sanitizer = inject(DomSanitizer);
  private readonly el = inject(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly motion = inject(MotionService);

  constructor() {
    this.safeMapEmbedUrl = this.sanitizer.bypassSecurityTrustResourceUrl(
      this.hotelConfig.googleMapsEmbedUrl
    );

    afterNextRender(() => {
      this.initAnimations();
    });
  }

  private initAnimations(): void {
    const root = this.el.nativeElement as HTMLElement;
    this.motion.createScope(
      root,
      () => {
        const block = root.querySelector<HTMLElement>('.testimonials-block');
        if (block) {
          this.motion.animateScrollReveal(block, { y: 28, duration: 0.85, trigger: block });
        }
      },
      this.destroyRef
    );
  }
}
