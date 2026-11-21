import { Component, afterNextRender, ElementRef, inject, DestroyRef } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ExperienceService } from '../../../../core/services/experience.service';
import { IconComponent } from '../../../../shared/components/icons/icon.component';
import { MotionService } from '../../../../core/services/motion.service';

@Component({
  selector: 'app-featured-experiences',
  imports: [RouterLink, IconComponent],
  template: `
    <section class="py-16 sm:py-20 lg:py-24 bg-[#F7F5F0] overflow-hidden" aria-labelledby="experiences-heading">
      <div class="container-editorial">
        
        <!-- Header -->
        <div class="exp-header max-w-2xl mb-8 sm:mb-10 lg:mb-12">
          <span class="type-eyebrow text-[#8A5A1E] block mb-2 sm:mb-3">
            Estrutura & Comodidades
          </span>
          <h2 id="experiences-heading" class="type-title text-[#054054]">
            Lazer e conveniência para seus dias em Cabo Frio.
          </h2>
        </div>

        <!-- Editorial Feature 1: Pool & Leisure -->
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center mb-12 sm:mb-16 lg:mb-20">
          <div class="exp-img-wrap-1 lg:col-span-8 parallax-container aspect-[16/10] shadow-sm">
            <img
              src="https://images.unsplash.com/photo-1576013551627-0cc20b96c2a7?auto=format&fit=crop&w=1600&q=85"
              alt="Área de piscina externa na pousada (imagem ilustrativa)"
              loading="lazy"
              class="exp-img-1 parallax-image w-full h-full object-cover"
            />
          </div>

          <div class="exp-text-1 lg:col-span-4 space-y-4 sm:space-y-5">
            <span class="type-eyebrow block text-[#536B73]">Lazer ao Ar Livre</span>
            <h3 class="font-serif text-3xl text-[#054054]">
              Piscina externa e espaços de descanso.
            </h3>
            <p class="type-body text-sm sm:text-base text-[#536B73]">
              A estrutura da Pousada Espírito do Mar conta com piscina externa, oferecendo uma opção agradável para relaxar antes ou depois de caminhar até a Praia do Peró.
            </p>
            <p class="type-body text-sm sm:text-base text-[#536B73]">
              Os hóspedes também contam com conexão Wi-Fi e estacionamento na propriedade (consulte disponibilidade de vagas e condições no ato da reserva).
            </p>
            <div class="pt-2">
              <a routerLink="/experiencias" class="btn-text">
                <span>Conhecer toda a estrutura</span>
                <app-icon name="arrow-right" [size]="13"></app-icon>
              </a>
            </div>
          </div>
        </div>

        <!-- Editorial Feature 2: Breakfast & Hospitality -->
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
          
          <!-- Text on left -->
          <div class="exp-text-2 lg:col-span-5 space-y-4 sm:space-y-5 lg:order-1 order-2">
            <span class="type-eyebrow block text-[#536B73]">Hospitalidade Diária</span>
            <h3 class="font-serif text-3xl text-[#054054]">
              Café da manhã e quartos equipados.
            </h3>
            <p class="type-body text-sm sm:text-base text-[#536B73]">
              Comece suas manhãs em Cabo Frio com o serviço de café da manhã da pousada (confirme horários e condições incluídas na sua tarifa ao reservar).
            </p>
            <p class="type-body text-sm sm:text-base text-[#536B73]">
              Todas as acomodações dispõem de ar-condicionado, televisão e banheiro privativo, com opções que incluem frigobar e categorias específicas com varanda.
            </p>
            <div class="pt-4">
              <a routerLink="/experiencias" class="btn-text">
                <span>Ver detalhes das comodidades</span>
                <app-icon name="arrow-right" [size]="13"></app-icon>
              </a>
            </div>
          </div>

          <!-- Vertical Photo on right -->
          <div class="exp-img-wrap-2 lg:col-span-7 editorial-image-container aspect-[16/11] lg:order-2 order-1 shadow-sm">
            <img
              src="https://images.unsplash.com/photo-1533089860892-a7c6f0a88666?auto=format&fit=crop&w=1600&q=85"
              alt="Café da manhã na pousada (imagem ilustrativa)"
              loading="lazy"
              class="exp-img-2 w-full h-full object-cover"
            />
          </div>

        </div>

      </div>
    </section>
  `
})
export class FeaturedExperiencesComponent {
  public readonly experienceService = inject(ExperienceService);
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
      const header = root.querySelector<HTMLElement>('.exp-header');
      const imgWrap1 = root.querySelector<HTMLElement>('.exp-img-wrap-1');
      const img1 = root.querySelector<HTMLElement>('.exp-img-1');
      const text1 = root.querySelector<HTMLElement>('.exp-text-1');

      const text2 = root.querySelector<HTMLElement>('.exp-text-2');
      const imgWrap2 = root.querySelector<HTMLElement>('.exp-img-wrap-2');
      const img2 = root.querySelector<HTMLElement>('.exp-img-2');

      if (header) {
        this.motion.animateScrollReveal(header, { y: 28, duration: 0.85 });
      }

      if (imgWrap1 && img1) {
        this.motion.animateParallax(img1, imgWrap1, { yPercent: 6, scrub: 0.5 });
      }

      if (text1) {
        this.motion.animateScrollReveal(text1, { y: 28, duration: 0.85, trigger: text1 });
      }

      if (text2) {
        this.motion.animateScrollReveal(text2, { y: 28, duration: 0.85, trigger: text2 });
      }

      if (imgWrap2 && img2) {
        this.motion.animateImageReveal(img2, imgWrap2, { duration: 1.1 });
      }
    }, this.destroyRef);
  }
}
