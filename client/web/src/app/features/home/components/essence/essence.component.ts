import { Component, afterNextRender, ElementRef, inject, DestroyRef } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../../../shared/components/icons/icon.component';
import { MotionService } from '../../../../core/services/motion.service';

@Component({
  selector: 'app-essence',
  imports: [RouterLink, IconComponent],
  template: `
    <section class="pt-10 sm:pt-14 lg:pt-16 pb-16 sm:pb-20 lg:pb-24 bg-[#F7F5F0]" aria-labelledby="essence-heading">
      <div class="container-editorial">
        
        <!-- Top Editorial Headline -->
        <div class="essence-header text-center mb-8 sm:mb-10 lg:mb-12">
          <h2 id="essence-heading" class="type-title text-[#054054] max-w-3xl mx-auto">
            Hospitalidade acolhedora pertinho da Praia do Peró.
          </h2>
        </div>

        <!-- Asymmetric Photography & Editorial Columns -->
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
          
          <!-- Large Editorial Image (Col 1-7) -->
          <div class="essence-image-wrap lg:col-span-7 editorial-image-container aspect-[4/5] sm:aspect-[16/11] lg:aspect-[4/3] shadow-sm">
            <img
              src="https://images.unsplash.com/photo-1566665797739-1674de7a421a?auto=format&fit=crop&w=1600&q=85"
              alt="Acomodação confortável na Pousada Espírito do Mar em Cabo Frio (imagem ilustrativa)"
              loading="lazy"
              class="essence-img w-full h-full object-cover"
            />
          </div>

          <!-- Restrained Text Content (Col 8-12) -->
          <div class="essence-text lg:col-span-5 flex flex-col justify-between h-full lg:pt-2">
            <div class="space-y-4 sm:space-y-5 type-body text-[#536B73]">
              <p>
                Na Pousada Espírito do Mar, você encontra uma opção de hospedagem em Cabo Frio para aproveitar o litoral com tranquilidade. Localizada no bairro Peró, a pousada oferece fácil acesso à praia e uma estrutura pensada para seus dias de descanso.
              </p>
              <p>
                Nossa estrutura conta com piscina externa, café da manhã, Wi-Fi e estacionamento no local (consulte disponibilidade e condições no momento da reserva).
              </p>
              <p>
                As acomodações dispõem de ar-condicionado, TV e banheiro privativo, além de unidades específicas que contam com varanda para tornar sua estadia ainda mais agradável na Região dos Lagos.
              </p>
            </div>

            <!-- Discrete Action Link -->
            <div class="pt-6 mt-6 border-t border-[#DCE6EA]">
              <a routerLink="/sobre" class="btn-text">
                <span>Conhecer a pousada e estrutura</span>
                <app-icon name="arrow-right" [size]="13"></app-icon>
              </a>
            </div>

          </div>

        </div>

      </div>
    </section>
  `
})
export class EssenceComponent {
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
      const header = root.querySelector<HTMLElement>('.essence-header');
      const imgWrap = root.querySelector<HTMLElement>('.essence-image-wrap');
      const img = root.querySelector<HTMLElement>('.essence-img');
      const text = root.querySelector<HTMLElement>('.essence-text');

      if (header) {
        this.motion.animateScrollReveal(header, { y: 28, duration: 0.85 });
      }

      if (imgWrap && img) {
        this.motion.animateImageReveal(img, imgWrap, { duration: 1.1 });
      }

      if (text) {
        this.motion.animateScrollReveal(text, {
          y: 28,
          duration: 0.85,
          delay: 0.15,
          trigger: text
        });
      }
    }, this.destroyRef);
  }
}
