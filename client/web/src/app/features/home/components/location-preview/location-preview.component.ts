import { Component, afterNextRender, ElementRef, inject, DestroyRef } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HOTEL_CONFIG } from '../../../../core/config/hotel-config';
import { IconComponent } from '../../../../shared/components/icons/icon.component';
import { MotionService } from '../../../../core/services/motion.service';

@Component({
  selector: 'app-location-preview',
  imports: [RouterLink, IconComponent],
  template: `
    <section class="py-16 sm:py-20 lg:py-24 bg-[#F7F5F0]" aria-labelledby="location-heading">
      <div class="container-editorial">
        
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
          
          <!-- Content Left (Col 1-5) -->
          <div class="loc-content-left lg:col-span-5 flex flex-col items-start">
            <span class="type-eyebrow text-[#8A5A1E] block mb-2 sm:mb-3">
              Localização em Cabo Frio
            </span>

            <h2 id="location-heading" class="type-title text-[#054054] mb-4">
              Explore Cabo Frio a partir do Peró
            </h2>

            <p class="type-body text-[#536B73] mb-6">
              A Pousada Espírito do Mar fica no bairro Peró, em Cabo Frio, próxima à praia e a opções de comércio e gastronomia da região.
            </p>

            <!-- Clean Editorial References List -->
            <div class="w-full divide-y divide-[#DCE6EA] border-y border-[#DCE6EA] mb-6 sm:mb-8 text-sm">
              @for (item of hotelConfig.nearbyPoints; track item.label) {
                <div class="flex flex-col sm:flex-row sm:items-center justify-between py-3 gap-1">
                  <span class="text-[#054054] font-medium">{{ item.label }}</span>
                  <span class="text-[#536B73] font-light text-xs sm:text-sm">{{ item.detail }}</span>
                </div>
              }
            </div>

            <!-- Actions -->
            <div class="flex flex-wrap items-center gap-4 sm:gap-6">
              <a
                [href]="hotelConfig.mapsQueryUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="btn-primary"
              >
                <span>Ver no Google Maps</span>
                <app-icon name="arrow-right" [size]="13"></app-icon>
              </a>

              <a
                routerLink="/localizacao"
                class="btn-text"
              >
                <span>Detalhes da localização</span>
              </a>
            </div>

          </div>

          <!-- Coastline Photography Right (Col 6-12) -->
          <div class="loc-content-right lg:col-span-7">
            <div class="loc-img-wrap editorial-image-container aspect-[16/11] shadow-sm relative">
              <img
                src="https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1600&q=85"
                alt="Paisagem costeira representando a região da Praia do Peró em Cabo Frio"
                loading="lazy"
                class="loc-img w-full h-full object-cover"
              />

              <!-- Architectural Corner Location Card -->
              <div class="loc-badge absolute bottom-6 left-6 p-5 bg-[#FAF8F5] border border-[#DCE6EA] max-w-xs shadow-md">
                <span class="type-caption block text-[#8A5A1E] font-semibold mb-1">Endereço de Referência</span>
                <p class="text-xs text-[#054054] font-medium mb-1">{{ hotelConfig.address.fullFormatted }}</p>
                <span class="type-caption block text-[#536B73]">Bairro Peró · Cabo Frio, RJ</span>
              </div>
            </div>
          </div>

        </div>

      </div>
    </section>
  `
})
export class LocationPreviewComponent {
  public readonly hotelConfig = HOTEL_CONFIG;
  private readonly el = inject(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly motion = inject(MotionService);

  constructor() {
    afterNextRender(() => {
      this.initAnimations();
    });
  }

  private initAnimations(): void {
    const root = this.el.nativeElement as HTMLElement;
    this.motion.createScope(root, () => {
      const leftCol = root.querySelector<HTMLElement>('.loc-content-left');
      const imgWrap = root.querySelector<HTMLElement>('.loc-img-wrap');
      const img = root.querySelector<HTMLElement>('.loc-img');
      const badge = root.querySelector<HTMLElement>('.loc-badge');

      if (leftCol) {
        this.motion.animateScrollReveal(leftCol, { y: 28, duration: 0.85, trigger: leftCol });
      }

      if (imgWrap && img) {
        this.motion.animateImageReveal(img, imgWrap, { duration: 1.0 });
      }

      if (badge) {
        this.motion.animateScrollReveal(badge, { y: 16, duration: 0.7, delay: 0.25, trigger: imgWrap || badge });
      }
    }, this.destroyRef);
  }
}
