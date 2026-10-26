import { Component, afterNextRender, ElementRef, inject, DestroyRef } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../../../shared/components/icons/icon.component';
import { MotionService } from '../../../../core/services/motion.service';

@Component({
  selector: 'app-hero',
  imports: [RouterLink, IconComponent],
  templateUrl: './hero.component.html'
})
export class HeroComponent {
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
      this.motion.animateHero(root, {
        background: root.querySelector<HTMLElement>('.hero-bg-img'),
        eyebrow: root.querySelector<HTMLElement>('.hero-eyebrow'),
        title: root.querySelector<HTMLElement>('.hero-title'),
        subtitle: root.querySelector<HTMLElement>('.hero-subtitle'),
        ctas: root.querySelector<HTMLElement>('.hero-ctas'),
        scrollIndicator: root.querySelector<HTMLElement>('.hero-scroll')
      });
    }, this.destroyRef);
  }

  public scrollToDiscover(): void {
    const target = document.getElementById('booking-section');
    if (target) {
      target.scrollIntoView({ behavior: 'smooth' });
    }
  }
}
