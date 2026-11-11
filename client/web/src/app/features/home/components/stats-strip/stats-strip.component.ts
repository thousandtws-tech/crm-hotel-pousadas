import { Component, afterNextRender, ElementRef, inject, DestroyRef } from '@angular/core';
import { MotionService } from '../../../../core/services/motion.service';
import { AccommodationService } from '../../../../core/services/accommodation.service';

interface Stat {
  valor: string;
  rotulo: string;
}

@Component({
  selector: 'app-stats-strip',
  template: `
    <section class="relative bg-[#032B38] py-12 sm:py-16 lg:py-18 overflow-hidden" aria-label="A pousada em números">
      <div class="absolute inset-0 bg-gradient-to-r from-[#032B38] via-[#054054]/40 to-[#032B38]"></div>
      <div class="relative container-editorial">
        <div class="stats-grid grid grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-6">
          @for (s of stats; track s.rotulo) {
            <div class="stat-item flex flex-col items-center text-center">
              <span class="font-serif text-4xl sm:text-5xl lg:text-6xl text-[#DDA554] leading-none mb-2">
                {{ s.valor }}
              </span>
              <span class="w-8 h-px bg-[#DDA554]/50 mb-3"></span>
              <span class="type-eyebrow !text-white/70 text-[10px] sm:text-xs normal-case tracking-[0.14em]">
                {{ s.rotulo }}
              </span>
            </div>
          }
        </div>
      </div>
    </section>
  `,
})
export class StatsStripComponent {
  private readonly el = inject(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly motion = inject(MotionService);
  private readonly accommodations = inject(AccommodationService);

  protected readonly stats: Stat[] = [
    { valor: String(this.accommodations.accommodations().length || 6), rotulo: 'Acomodações climatizadas' },
    { valor: '200m', rotulo: 'Da Praia do Peró' },
    { valor: '4,9', rotulo: 'Avaliação dos hóspedes' },
    { valor: '10+', rotulo: 'Anos de hospitalidade' },
  ];

  constructor() {
    afterNextRender(() => {
      const root = this.el.nativeElement as HTMLElement;
      this.motion.createScope(root, () => {
        const items = root.querySelectorAll<HTMLElement>('.stat-item');
        if (items.length) {
          this.motion.animateScrollReveal(Array.from(items), {
            y: 24, duration: 0.8, stagger: 0.1,
            trigger: root.querySelector<HTMLElement>('.stats-grid') ?? items[0],
          });
        }
      }, this.destroyRef);
    });
  }
}
