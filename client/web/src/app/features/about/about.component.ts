import { Component, afterNextRender, ElementRef, inject, DestroyRef, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SeoService } from '../../core/services/seo.service';
import { IconComponent } from '../../shared/components/icons/icon.component';
import { MotionService } from '../../core/services/motion.service';
import { HOTEL_CONFIG } from '../../core/config/hotel-config';

@Component({
  selector: 'app-about',
  imports: [RouterLink, IconComponent],
  template: `
    <!-- Header Hero -->
    <header class="about-page-header relative pt-28 pb-12 sm:pt-32 sm:pb-14 lg:pt-36 lg:pb-16 bg-[#032B38] text-white overflow-hidden">
      <div class="absolute inset-0 z-0">
        <img
          src="https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=2200&q=85"
          alt="Apresentação da Pousada Espírito do Mar no Peró, Cabo Frio"
          class="w-full h-full object-cover object-center filter brightness-[0.5]"
        />
        <div class="absolute inset-0 bg-gradient-to-t from-[#032B38] via-[#032B38]/50 to-transparent"></div>
      </div>

      <div class="relative z-10 container-editorial text-center flex flex-col items-center">
        <h1 class="font-serif text-4xl sm:text-6xl text-white font-normal mb-3 sm:mb-4 leading-tight">
          Sobre a Pousada Espírito do Mar
        </h1>
        <p class="text-sm sm:text-base text-[#F7F5F0]/80 font-light max-w-xl leading-relaxed">
          Uma opção acolhedora de hospedagem em Cabo Frio, próxima à Praia do Peró, pensada para dias de tranquilidade e descanso.
        </p>
      </div>
    </header>

    <!-- Narrative Section -->
    <section class="about-manifesto py-14 sm:py-18 lg:py-20 bg-[#F7F5F0]">
      <div class="container-editorial">
        <div class="max-w-3xl mx-auto space-y-8 sm:space-y-10">
          
          <div>
            <h2 class="type-title text-[#054054]">
              Sua estadia pertinho da Praia do Peró.
            </h2>
          </div>

          <div class="space-y-4 sm:space-y-5 type-body text-base">
            <p>
              {{ hotelConfig.description }}
            </p>
            <p>
              Nossa proposta é oferecer um ambiente simples, funcional e acolhedor para casais, famílias e viajantes que visitam a Região dos Lagos. Nas áreas comuns, os hóspedes contam com piscina externa, serviço de café da manhã, Wi-Fi e estacionamento no local (consulte disponibilidade de vagas e condições vigentes no ato da reserva).
            </p>
            <p>
              As acomodações são equipadas com ar-condicionado, televisão e banheiro privativo, além de opções com frigobar e unidades específicas que dispõem de varanda.
            </p>
          </div>

        </div>
      </div>
    </section>

    <!-- Confirmed Structure Pillars Section -->
    <section class="about-pillars py-14 sm:py-18 lg:py-20 bg-[#EEF3F5] border-y border-[#DCE6EA]">
      <div class="container-editorial">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-8 lg:gap-12">
          
          <div class="about-pillar flex flex-col items-start">
            <span class="font-serif text-2xl text-[#DDA554] mb-2 sm:mb-3">01</span>
            <h3 class="font-serif text-2xl text-[#054054] mb-2 sm:mb-3">Proximidade da Praia</h3>
            <p class="type-body text-sm">
              Localizada na Rua Anequim, no bairro Peró, a pousada permite fácil acesso à Praia do Peró e a serviços, quiosques e restaurantes da região.
            </p>
          </div>

          <div class="about-pillar flex flex-col items-start">
            <span class="font-serif text-2xl text-[#DDA554] mb-2 sm:mb-3">02</span>
            <h3 class="font-serif text-2xl text-[#054054] mb-2 sm:mb-3">Estrutura de Apoio</h3>
            <p class="type-body text-sm">
              Piscina externa ao ar livre, café da manhã, Wi-Fi e estacionamento na propriedade (confirme horários e condições aplicáveis na sua reserva).
            </p>
          </div>

          <div class="about-pillar flex flex-col items-start">
            <span class="font-serif text-2xl text-[#DDA554] mb-2 sm:mb-3">03</span>
            <h3 class="font-serif text-2xl text-[#054054] mb-2 sm:mb-3">Quartos Climatizados</h3>
            <p class="type-body text-sm">
              Unidades para 2, 3 ou até 4 hóspedes, todas com ar-condicionado, TV e banheiro privativo, além de categorias específicas com varanda.
            </p>
          </div>

        </div>
      </div>
    </section>

    <!-- Bottom Action -->
    <section class="about-bottom-action py-14 sm:py-18 bg-[#F7F5F0] text-center">
      <div class="container-editorial max-w-xl mx-auto flex flex-col items-center">
        <h2 class="type-title text-[#054054] mb-3 sm:mb-4">Consulte a disponibilidade</h2>
        <p class="type-body mb-6">Entre em contato com nossa recepção ou envie sua consulta para verificar datas, acomodações e tarifas para sua viagem a Cabo Frio.</p>
        <div class="flex flex-wrap items-center justify-center gap-4">
          <a routerLink="/reservar" class="btn-primary">
            <span>Consultar disponibilidade</span>
            <app-icon name="arrow-right" [size]="13"></app-icon>
          </a>
          <a routerLink="/acomodacoes" class="btn-secondary">
            <span>Conheça nossas acomodações</span>
          </a>
        </div>
      </div>
    </section>
  `
})
export class AboutComponent implements OnInit {
  public readonly hotelConfig = HOTEL_CONFIG;
  private readonly seoService = inject(SeoService);
  private readonly el = inject(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly motion = inject(MotionService);

  constructor() {
    afterNextRender(() => {
      this.initAnimations();
    });
  }

  public ngOnInit(): void {
    this.seoService.updateSeo({
      title: 'Sobre a Pousada Espírito do Mar | Hospedagem no Peró, Cabo Frio',
      description: 'Conheça a Pousada Espírito do Mar, localizada no bairro Peró, em Cabo Frio (RJ). Estrutura com piscina externa, café da manhã e fácil acesso à Praia do Peró.',
      url: 'https://pousadaespiritodomar.com.br/sobre'
    });
  }

  private initAnimations(): void {
    const root = this.el.nativeElement as HTMLElement;
    this.motion.createScope(root, () => {
      const header = root.querySelector<HTMLElement>('.about-page-header');
      const manifesto = root.querySelector<HTMLElement>('.about-manifesto');
      const pillarsSection = root.querySelector<HTMLElement>('.about-pillars');
      const pillars = root.querySelectorAll<HTMLElement>('.about-pillar');
      const bottom = root.querySelector<HTMLElement>('.about-bottom-action');

      if (header) {
        this.motion.animateScrollReveal(header, { y: 28, duration: 0.85 });
      }

      if (manifesto) {
        this.motion.animateScrollReveal(manifesto, { y: 32, duration: 0.9, trigger: manifesto });
      }

      if (pillars.length && pillarsSection) {
        this.motion.animateScrollReveal(Array.from(pillars), {
          y: 28,
          duration: 0.85,
          stagger: 0.12,
          trigger: pillarsSection
        });
      }

      if (bottom) {
        this.motion.animateScrollReveal(bottom, { y: 24, duration: 0.8, trigger: bottom });
      }
    }, this.destroyRef);
  }
}
