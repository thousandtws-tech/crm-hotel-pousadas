import { Component, afterNextRender, ElementRef, inject, DestroyRef, computed } from '@angular/core';
import { IconComponent } from '../../../../shared/components/icons/icon.component';
import { MotionService } from '../../../../core/services/motion.service';
import { SiteContentService, cmsStr } from '../../../../core/services/site-content.service';

const PADRAO_BG = 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=2400&q=90';

@Component({
  selector: 'app-hero',
  imports: [IconComponent],
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
  protected readonly eyebrow = computed(
    () => cmsStr(this.site.secao('hero'), 'eyebrow') || 'Bairro Peró · Cabo Frio, RJ'
  );
  protected readonly bgImg = computed(
    () => this.site.midiaUrl(this.site.secao('hero')?.['imagem']) || PADRAO_BG
  );
  protected readonly cta1Label = computed(
    () => cmsStr(this.site.secao('hero'), 'cta1_label') || 'Consultar disponibilidade'
  );
  protected readonly cta1Href = computed(
    () => cmsStr(this.site.secao('hero'), 'cta1_href') || '/reservar'
  );
  protected readonly cta2Label = computed(
    () => cmsStr(this.site.secao('hero'), 'cta2_label') || 'Conheça nossas acomodações'
  );
  protected readonly cta2Href = computed(
    () => cmsStr(this.site.secao('hero'), 'cta2_href') || '/acomodacoes'
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
