import { Component, afterNextRender, ElementRef, inject, DestroyRef, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../../../shared/components/icons/icon.component';
import { MotionService } from '../../../../core/services/motion.service';
import { SiteContentService } from '../../../../core/services/site-content.service';

@Component({
  selector: 'app-hero',
  imports: [RouterLink, IconComponent],
  templateUrl: './hero.component.html'
})
export class HeroComponent {
  private readonly el = inject(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly motion = inject(MotionService);
  private readonly site = inject(SiteContentService);

  // Conteúdo editável pelo CMS — fallback preserva o texto original.
  protected readonly titulo = computed(
    () => this.site.hero()?.titulo || 'Pousada Espírito do Mar: sua estadia pertinho da Praia do Peró'
  );
  protected readonly subtitulo = computed(
    () => this.site.hero()?.subtitulo
      || 'Em Cabo Frio, aproveite dias de descanso em uma pousada acolhedora, com piscina e fácil acesso à Praia do Peró.'
  );

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
