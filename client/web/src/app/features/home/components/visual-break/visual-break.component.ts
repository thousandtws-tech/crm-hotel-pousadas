import { Component, afterNextRender, ElementRef, inject, DestroyRef } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../../../shared/components/icons/icon.component';
import { MotionService } from '../../../../core/services/motion.service';

@Component({
  selector: 'app-visual-break',
  imports: [RouterLink, IconComponent],
  template: `
    <section class="break-section relative w-full min-h-[380px] sm:min-h-[440px] lg:min-h-[500px] flex items-center justify-center overflow-hidden bg-[#032B38] text-white py-14 sm:py-18 lg:py-20">
      <!-- High-Impact Panoramic Horizon Background with Parallax -->
      <div class="break-img-wrap absolute inset-0 z-0 overflow-hidden">
        <img
          src="https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=2200&q=85"
          alt="Paisagem litorânea em Cabo Frio próxima à Praia do Peró"
          loading="lazy"
          class="break-img parallax-image w-full h-full object-cover object-center filter brightness-[0.65]"
        />
        <div class="absolute inset-0 bg-[#032B38]/55"></div>
      </div>

      <!-- Center Minimalist Typography -->
      <div class="break-content relative z-10 container-editorial text-center flex flex-col items-center">
        <h2 class="font-serif text-3xl sm:text-5xl lg:text-6xl text-white font-normal leading-[1.18] max-w-3xl mb-6">
          “Tranquilidade, piscina e fácil acesso à Praia do Peró para aproveitar seus dias em Cabo Frio.”
        </h2>

        <a
          routerLink="/reservar"
          class="btn-secondary-light group"
        >
          <span>Consultar disponibilidade</span>
          <app-icon name="arrow-right" [size]="13" class="transition-transform duration-300 group-hover:translate-x-1 text-[#ffff]"></app-icon>
        </a>
      </div>
    </section>
  `
})
export class VisualBreakComponent {
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
      const section = root.querySelector<HTMLElement>('.break-section');
      const img = root.querySelector<HTMLElement>('.break-img');
      const content = root.querySelector<HTMLElement>('.break-content');

      if (section && img) {
        this.motion.animateParallax(img, section, { yPercent: 8, scrub: 0.6 });
      }

      if (content) {
        this.motion.animateScrollReveal(content, { y: 28, duration: 0.9, trigger: content });
      }
    }, this.destroyRef);
  }
}
