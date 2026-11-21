import { Component, afterNextRender, ElementRef, inject, DestroyRef, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HOTEL_CONFIG } from '../../core/config/hotel-config';
import { SeoService } from '../../core/services/seo.service';
import { IconComponent } from '../../shared/components/icons/icon.component';
import { MotionService } from '../../core/services/motion.service';

@Component({
  selector: 'app-terms',
  imports: [RouterLink, IconComponent],
  template: `
    <!-- Header Hero -->
    <header class="terms-page-header relative pt-28 pb-12 sm:pt-32 sm:pb-14 lg:pt-36 lg:pb-16 bg-[#032B38] text-white overflow-hidden">
      <div class="absolute inset-0 z-0">
        <img
          src="https://images.unsplash.com/photo-1566665797739-1674de7a421a?auto=format&fit=crop&w=2200&q=85"
          alt="Informações e termos de reserva na Pousada Espírito do Mar"
          class="w-full h-full object-cover object-center filter brightness-[0.45]"
        />
        <div class="absolute inset-0 bg-gradient-to-t from-[#032B38] via-[#032B38]/55 to-transparent"></div>
      </div>

      <div class="relative z-10 container-editorial text-center flex flex-col items-center">
        <span class="type-eyebrow text-[#8A5A1E] block mb-2 sm:mb-3">
          Informações ao Hóspede
        </span>
        <h1 class="font-serif text-4xl sm:text-6xl text-white font-normal mb-3 sm:mb-4 leading-tight">
          Informações & Condições de Hospedagem
        </h1>
        <p class="text-sm sm:text-base text-[#F7F5F0]/80 font-light max-w-2xl leading-relaxed">
          Orientações gerais sobre horários de referência, solicitações de reserva e convivência na Pousada Espírito do Mar, no bairro Peró, em Cabo Frio (RJ).
        </p>
      </div>
    </header>

    <!-- Main Content -->
    <section class="py-14 sm:py-18 lg:py-20 bg-[#F7F5F0]">
      <div class="container-editorial">
        <div class="max-w-4xl mx-auto space-y-12">

          <!-- Executive Summary Callout -->
          <div class="terms-card p-6 sm:p-8 bg-white border border-[#DCE6EA] shadow-sm">
            <div class="flex items-center gap-3 mb-4">
              <span class="w-2.5 h-2.5 rounded-full bg-[#DDA554]"></span>
              <span class="type-eyebrow text-[#054054]">Transparência na Reserva</span>
            </div>
            <p class="type-body text-base text-[#054054] font-medium leading-relaxed mb-3">
              Todas as tarifas, políticas de pagamento e condições específicas são informadas e confirmadas diretamente no momento da reserva com a {{ hotelConfig.businessName }}.
            </p>
            <p class="type-body text-sm text-[#536B73] leading-relaxed">
              Observamos a legislação aplicável ao setor de hospedagem e o Código de Defesa do Consumidor (Lei nº 8.078/1990). Recomendamos sempre validar todas as condições aplicáveis ao período escolhido antes da conclusão da reserva.
            </p>
            <div class="mt-4 pt-4 border-t border-[#DCE6EA] flex flex-wrap items-center justify-between gap-4 text-xs text-[#536B73]">
              <span>Atendimento: {{ hotelConfig.phone }}</span>
              <span class="text-[#054054] font-medium">Bairro Peró · Cabo Frio, RJ</span>
            </div>
          </div>

          <!-- Chapter 1: Consulta e Confirmação de Reserva -->
          <article class="terms-chapter bg-white p-6 sm:p-8 border border-[#DCE6EA] shadow-sm">
            <span class="type-eyebrow text-[#8A5A1E] block mb-2">01 · Solicitação de Reserva</span>
            <h2 class="font-serif text-2xl sm:text-3xl text-[#054054] mb-4">Cotação, Disponibilidade e Confirmação</h2>
            
            <div class="space-y-4 type-body text-sm sm:text-base text-[#536B73]">
              <p>
                O envio de consulta através do formulário deste website não constitui confirmação automática de reserva. A disponibilidade de quartos, os valores de diárias para o período pretendido e as formas de pagamento aceitas são informados diretamente pelo atendimento da pousada.
              </p>
              
              <ul class="space-y-2.5 text-sm">
                <li class="flex items-start gap-2.5">
                  <span class="w-1.5 h-1.5 rounded-full bg-[#DDA554] mt-2 flex-shrink-0"></span>
                  <span><strong>Tarifas sob consulta:</strong> Os valores variam conforme a época do ano, feriados, número de hóspedes e categoria de quarto selecionada.</span>
                </li>
                <li class="flex items-start gap-2.5">
                  <span class="w-1.5 h-1.5 rounded-full bg-[#DDA554] mt-2 flex-shrink-0"></span>
                  <span><strong>Condições de confirmação e cancelamento:</strong> As regras de pré-pagamento, alteração de datas e cancelamento variam conforme a modalidade tarifária e o período, sendo detalhadas ao hóspede no ato da cotação.</span>
                </li>
              </ul>
            </div>
          </article>

          <!-- Chapter 2: Check-in e Check-out -->
          <article class="terms-chapter bg-white p-6 sm:p-8 border border-[#DCE6EA] shadow-sm">
            <span class="type-eyebrow text-[#8A5A1E] block mb-2">02 · Horários de Referência</span>
            <h2 class="font-serif text-2xl sm:text-3xl text-[#054054] mb-4">Check-in e Check-out</h2>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div class="p-4 bg-[#FAF8F5] border-l-2 border-[#054054] border-t border-r border-b border-[#DCE6EA]">
                <span class="type-caption block text-[#8A5A1E] font-medium mb-1">Entrada divulgada</span>
                <span class="font-serif text-2xl text-[#054054] block mb-1">Check-in: a partir das 13h</span>
                <p class="text-xs text-[#536B73]">Necessária apresentação de documento oficial de identificação com foto de todos os hóspedes.</p>
              </div>

              <div class="p-4 bg-[#FAF8F5] border-l-2 border-[#DDA554] border-t border-r border-b border-[#DCE6EA]">
                <span class="type-caption block text-[#8A5A1E] font-medium mb-1">Saída divulgada</span>
                <span class="font-serif text-2xl text-[#054054] block mb-1">Check-out: até as 11h</span>
                <p class="text-xs text-[#536B73]">Confirme com a recepção eventuais variações de horário aplicáveis à sua reserva.</p>
              </div>
            </div>
          </article>

          <!-- Chapter 3: Comodidades e Serviços -->
          <article class="terms-chapter bg-white p-6 sm:p-8 border border-[#DCE6EA] shadow-sm">
            <span class="type-eyebrow text-[#8A5A1E] block mb-2">03 · Estrutura e Acomodações</span>
            <h2 class="font-serif text-2xl sm:text-3xl text-[#054054] mb-4">Uso da Estrutura, Estacionamento e Categorias</h2>

            <div class="space-y-3 type-body text-sm sm:text-base text-[#536B73]">
              <p>
                A estrutura divulgada da pousada compreende piscina externa, café da manhã, Wi-Fi e estacionamento, além de quartos equipados com ar-condicionado, TV e banheiro privativo.
              </p>
              <ul class="space-y-2 text-xs sm:text-sm pl-4 list-disc">
                <li><strong>Unidades com varanda:</strong> Apenas determinadas categorias possuem varanda privativa. Caso deseje esse diferencial, solicite confirmação expressa de disponibilidade antes de fechar a reserva.</li>
                <li><strong>Estacionamento:</strong> Sujeito à disponibilidade de vagas e às normas internas de utilização; confirme no ato da reserva.</li>
                <li><strong>Café da manhã:</strong> Confirme os horários de serviço e as condições incluídas na sua diária diretamente com a recepção.</li>
              </ul>
            </div>
          </article>

          <!-- Chapter 4: Crianças e Animais de Estimação -->
          <article class="terms-chapter bg-white p-6 sm:p-8 border border-[#DCE6EA] shadow-sm">
            <span class="type-eyebrow text-[#8A5A1E] block mb-2">04 · Orientações Específicas</span>
            <h2 class="font-serif text-2xl sm:text-3xl text-[#054054] mb-4">Menores de Idade e Animais de Estimação</h2>

            <div class="space-y-4 type-body text-sm sm:text-base text-[#536B73]">
              <p>
                <strong>Hospedagem de Menores:</strong> Nos termos do Estatuto da Criança e do Adolescente (Lei nº 8.069/1990), menores de 18 anos devem apresentar documento oficial de identificação e estar acompanhados dos pais ou responsável legal, ou portar autorização formal conforme a legislação vigente. Consulte a recepção sobre regras de acomodação por faixa etária.
              </p>
              <p>
                <strong>Animais de Estimação:</strong> A aceitação de animais de estimação ocorre mediante solicitação prévia. Antes de efetuar sua reserva, consulte diretamente a pousada para confirmar disponibilidade, porte permitido e regras de convivência.
              </p>
            </div>
          </article>

          <!-- Direct Contact Card -->
          <article class="terms-chapter p-6 sm:p-8 bg-[#054054] text-white">
            <span class="type-eyebrow text-[#8A5A1E] block mb-2">Atendimento Direto</span>
            <h2 class="font-serif text-2xl sm:text-3xl text-white mb-4">Dúvidas sobre sua estadia?</h2>
            <p class="text-sm text-[#EEF3F5]/90 leading-relaxed mb-6">
              Entre em contato com a recepção pelo telefone ou envie uma mensagem pela página de contato para confirmar todas as condições da sua hospedagem no Peró.
            </p>

            <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 bg-white/10 border border-white/20">
              <div>
                <span class="text-xs text-[#8A5A1E] block mb-1">Telefone de Atendimento</span>
                <span class="font-medium text-base text-white">{{ hotelConfig.phone }}</span>
              </div>
              <a
                [href]="'tel:' + hotelConfig.phoneHref"
                class="btn-primary bg-[#DDA554] text-[#054054] hover:bg-white transition-colors"
              >
                <span>Ligar agora</span>
                <app-icon name="arrow-right" [size]="13"></app-icon>
              </a>
            </div>
          </article>

          <!-- Back Navigation Link -->
          <div class="pt-4 flex items-center justify-between">
            <a routerLink="/" class="btn-text">
              <app-icon name="chevron-left" [size]="13"></app-icon>
              <span>Voltar à Página Inicial</span>
            </a>

            <a routerLink="/privacidade" class="btn-text">
              <span>Política de Privacidade & LGPD</span>
              <app-icon name="arrow-right" [size]="13"></app-icon>
            </a>
          </div>

        </div>
      </div>
    </section>
  `
})
export class TermsComponent implements OnInit {
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
      title: 'Informações & Condições de Hospedagem | Pousada Espírito do Mar',
      description: 'Consulte as orientações gerais de hospedagem, horários de check-in e check-out e informações de reserva na Pousada Espírito do Mar, no Peró, Cabo Frio.',
      url: `${HOTEL_CONFIG.siteUrl}/termos-de-reserva`
    });
  }

  private initAnimations(): void {
    const root = this.el.nativeElement as HTMLElement;
    this.motion.createScope(root, () => {
      const header = root.querySelector<HTMLElement>('.terms-page-header');
      const cards = root.querySelectorAll<HTMLElement>('.terms-card, .terms-chapter');

      if (header) {
        this.motion.animateScrollReveal(header, { y: 24, duration: 0.85 });
      }

      if (cards.length > 0) {
        this.motion.animateScrollReveal(Array.from(cards), {
          y: 28,
          duration: 0.85,
          stagger: 0.1,
          trigger: cards[0]
        });
      }
    }, this.destroyRef);
  }
}
