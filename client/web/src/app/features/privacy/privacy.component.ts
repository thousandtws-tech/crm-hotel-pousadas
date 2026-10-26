import { Component, afterNextRender, ElementRef, inject, DestroyRef, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HOTEL_CONFIG } from '../../core/config/hotel-config';
import { SeoService } from '../../core/services/seo.service';
import { IconComponent } from '../../shared/components/icons/icon.component';
import { MotionService } from '../../core/services/motion.service';

@Component({
  selector: 'app-privacy',
  imports: [RouterLink, IconComponent],
  template: `
    <!-- Header Hero -->
    <header class="privacy-page-header relative pt-28 pb-12 sm:pt-32 sm:pb-14 lg:pt-36 lg:pb-16 bg-[#032B38] text-white overflow-hidden">
      <div class="absolute inset-0 z-0">
        <img
          src="https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=2200&q=85"
          alt="Costa e privacidade na Pousada Espírito do Mar"
          class="w-full h-full object-cover object-center filter brightness-[0.45]"
        />
        <div class="absolute inset-0 bg-gradient-to-t from-[#032B38] via-[#032B38]/55 to-transparent"></div>
      </div>

      <div class="relative z-10 container-editorial text-center flex flex-col items-center">
        <span class="type-eyebrow text-[#DDA554] block mb-2 sm:mb-3">
          Transparência & Conformidade
        </span>
        <h1 class="font-serif text-4xl sm:text-6xl text-white font-normal mb-3 sm:mb-4 leading-tight">
          Política de Privacidade & LGPD
        </h1>
        <p class="text-sm sm:text-base text-[#F7F5F0]/80 font-light max-w-2xl leading-relaxed">
          Nosso compromisso inegociável com a segurança, o sigilo e o tratamento ético dos seus dados pessoais, em conformidade com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018).
        </p>
      </div>
    </header>

    <!-- Main Content -->
    <section class="py-14 sm:py-18 lg:py-20 bg-[#F7F5F0]">
      <div class="container-editorial">
        <div class="max-w-4xl mx-auto space-y-12">

          <!-- Executive Summary Callout -->
          <div class="privacy-card p-6 sm:p-8 bg-white border border-[#DCE6EA] shadow-sm">
            <div class="flex items-center gap-3 mb-4">
              <span class="w-2.5 h-2.5 rounded-full bg-[#DDA554]"></span>
              <span class="type-eyebrow text-[#054054]">Compromisso de Sigilo</span>
            </div>
            <p class="type-body text-base text-[#054054] font-medium leading-relaxed mb-3">
              A {{ hotelConfig.businessName }} preza pelo respeito e proteção dos dados pessoais de seus hóspedes e visitantes.
            </p>
            <p class="type-body text-sm text-[#536B73] leading-relaxed">
              Não comercializamos nem compartilhamos indevidamente dados pessoais. As informações coletadas destinam-se exclusivamente ao atendimento de consultas de disponibilidade, operacionalização da hospedagem e cumprimento de obrigações legais aplicáveis ao setor hoteleiro em Cabo Frio (RJ).
            </p>
            <div class="mt-4 pt-4 border-t border-[#DCE6EA] flex flex-wrap items-center justify-between gap-4 text-xs text-[#536B73]">
              <span>Última atualização: Outubro de 2026</span>
              <span class="text-[#054054] font-medium">Em conformidade com a Lei nº 13.709/2018 (LGPD)</span>
            </div>
          </div>

          <!-- Chapter 1: Controlador dos Dados -->
          <article class="privacy-chapter bg-white p-6 sm:p-8 border border-[#DCE6EA] shadow-sm">
            <span class="type-eyebrow text-[#DDA554] block mb-2">01 · Identificação</span>
            <h2 class="font-serif text-2xl sm:text-3xl text-[#054054] mb-4">Controlador dos Dados Pessoais</h2>
            
            <div class="space-y-4 type-body text-sm sm:text-base text-[#536B73]">
              <p>
                O responsável pelas decisões referentes ao tratamento de dados pessoais no âmbito deste website e dos serviços de hospedagem é:
              </p>
              <div class="p-4 bg-[#F7F5F0] border border-[#DCE6EA] text-sm text-[#054054] space-y-1.5">
                <p><strong>Estabelecimento:</strong> {{ hotelConfig.businessName }}</p>
                <p><strong>Localização:</strong> {{ hotelConfig.address.fullFormatted }}</p>
                <p><strong>Telefone de Atendimento:</strong> <a [href]="'tel:' + hotelConfig.phoneHref" class="text-[#054054] underline hover:text-[#DDA554]">{{ hotelConfig.phone }}</a></p>
              </div>
            </div>
          </article>

          <!-- Chapter 2: Dados Coletados -->
          <article class="privacy-chapter bg-white p-6 sm:p-8 border border-[#DCE6EA] shadow-sm">
            <span class="type-eyebrow text-[#DDA554] block mb-2">02 · Coleta e Finalidades</span>
            <h2 class="font-serif text-2xl sm:text-3xl text-[#054054] mb-4">Dados Coletados e Finalidades do Tratamento</h2>

            <div class="space-y-5 type-body text-sm sm:text-base text-[#536B73]">
              <p>Coletamos apenas os dados necessários para viabilizar o atendimento e a sua hospedagem:</p>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                <div class="p-4 bg-[#FAF8F5] border border-[#DCE6EA]">
                  <h3 class="font-serif text-base text-[#054054] mb-1 font-medium">Dados de Reserva & FNRH</h3>
                  <p class="text-xs text-[#536B73] leading-relaxed">
                    Nome completo, CPF ou Passaporte, nacionalidade, data de nascimento, e-mail e telefone. Finalidade: formalização da reserva e preenchimento da Ficha Nacional de Registro de Hóspedes (FNRH), exigência legal do Ministério do Turismo.
                  </p>
                </div>

                <div class="p-4 bg-[#FAF8F5] border border-[#DCE6EA]">
                  <h3 class="font-serif text-base text-[#054054] mb-1 font-medium">Dados Financeiros</h3>
                  <p class="text-xs text-[#536B73] leading-relaxed">
                    Comprovantes de pagamento necessários para confirmação de reservas. <strong>Importante:</strong> não solicitamos nem armazenamos senhas bancárias através deste website.
                  </p>
                </div>

                <div class="p-4 bg-[#FAF8F5] border border-[#DCE6EA]">
                  <h3 class="font-serif text-base text-[#054054] mb-1 font-medium">Observações da Estadia</h3>
                  <p class="text-xs text-[#536B73] leading-relaxed">
                    Preferências de categoria de acomodação (como quarto com varanda), quantidade de hóspedes, horário previsto de chegada e dúvidas operacionais informadas voluntariamente no formulário de contato.
                  </p>
                </div>

                <div class="p-4 bg-[#FAF8F5] border border-[#DCE6EA]">
                  <h3 class="font-serif text-base text-[#054054] mb-1 font-medium">Registros de Navegação</h3>
                  <p class="text-xs text-[#536B73] leading-relaxed">
                    Endereço IP, data e hora de acesso e dados técnicos necessários para manter a segurança e a integridade da plataforma web (Marco Civil da Internet, Lei nº 12.965/2014).
                  </p>
                </div>
              </div>
            </div>
          </article>

          <!-- Chapter 3: Bases Legais -->
          <article class="privacy-chapter bg-white p-6 sm:p-8 border border-[#DCE6EA] shadow-sm">
            <span class="type-eyebrow text-[#DDA554] block mb-2">03 · Fundamentação Jurídica</span>
            <h2 class="font-serif text-2xl sm:text-3xl text-[#054054] mb-4">Bases Legais para o Tratamento (Art. 7º da LGPD)</h2>

            <div class="space-y-4 type-body text-sm sm:text-base text-[#536B73]">
              <p>Todo tratamento de dados realizado pela pousada está amparado em hipóteses legítimas previstas no Artigo 7º da Lei Geral de Proteção de Dados:</p>
              
              <ul class="space-y-2.5 text-sm">
                <li class="flex items-start gap-2.5">
                  <span class="w-1.5 h-1.5 rounded-full bg-[#DDA554] mt-2 flex-shrink-0"></span>
                  <span><strong>Execução de Contrato (Art. 7º, V):</strong> Para processar sua reserva de hospedagem, emitir vouchers e garantir a prestação dos serviços contratados.</span>
                </li>
                <li class="flex items-start gap-2.5">
                  <span class="w-1.5 h-1.5 rounded-full bg-[#DDA554] mt-2 flex-shrink-0"></span>
                  <span><strong>Obrigação Legal ou Regulatória (Art. 7º, II):</strong> Cumprimento das normas do Ministério do Turismo (FNRH), emissão de notas fiscais e obrigações tributárias e fiscais.</span>
                </li>
                <li class="flex items-start gap-2.5">
                  <span class="w-1.5 h-1.5 rounded-full bg-[#DDA554] mt-2 flex-shrink-0"></span>
                  <span><strong>Legítimo Interesse (Art. 7º, IX):</strong> Para aperfeiçoamento contínuo da segurança física e digital dos hóspedes, e aprimoramento dos serviços de gastronomia e bem-estar.</span>
                </li>
                <li class="flex items-start gap-2.5">
                  <span class="w-1.5 h-1.5 rounded-full bg-[#DDA554] mt-2 flex-shrink-0"></span>
                  <span><strong>Consentimento Livre e Esclarecido (Art. 7º, I):</strong> Para envio de comunicações sazonais do caderno de hospitalidade e registro de preferências individuais.</span>
                </li>
              </ul>
            </div>
          </article>

          <!-- Chapter 4: Direitos do Titular -->
          <article class="privacy-chapter bg-white p-6 sm:p-8 border border-[#DCE6EA] shadow-sm">
            <span class="type-eyebrow text-[#DDA554] block mb-2">04 · Autonomia</span>
            <h2 class="font-serif text-2xl sm:text-3xl text-[#054054] mb-4">Seus Direitos como Titular de Dados (Art. 18 da LGPD)</h2>

            <div class="space-y-4 type-body text-sm sm:text-base text-[#536B73]">
              <p>A qualquer momento, mediante requisição direta e simplificada ao nosso Encarregado de Dados, você poderá exercer seus direitos de:</p>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm pt-2">
                <div class="p-3 bg-[#F7F5F0] border border-[#DCE6EA]">
                  <strong class="text-[#054054] block mb-1">Confirmação e Acesso</strong>
                  <span class="text-xs">Saber se tratamos seus dados e solicitar cópia integral dos mesmos.</span>
                </div>
                <div class="p-3 bg-[#F7F5F0] border border-[#DCE6EA]">
                  <strong class="text-[#054054] block mb-1">Correção</strong>
                  <span class="text-xs">Solicitar a retificação imediata de dados incompletos, inexatos ou desatualizados.</span>
                </div>
                <div class="p-3 bg-[#F7F5F0] border border-[#DCE6EA]">
                  <strong class="text-[#054054] block mb-1">Anonimização ou Exclusão</strong>
                  <span class="text-xs">Pedir o descarte de dados desnecessários ou excessivos após o término da estadia.</span>
                </div>
                <div class="p-3 bg-[#F7F5F0] border border-[#DCE6EA]">
                  <strong class="text-[#054054] block mb-1">Revogação do Consentimento</strong>
                  <span class="text-xs">Cancelar a qualquer tempo o recebimento de e-mails sazonais ou avisos de reservas.</span>
                </div>
              </div>
            </div>
          </article>

          <!-- Chapter 5: Segurança e Retenção -->
          <article class="privacy-chapter bg-white p-6 sm:p-8 border border-[#DCE6EA] shadow-sm">
            <span class="type-eyebrow text-[#DDA554] block mb-2">05 · Proteção Técnica</span>
            <h2 class="font-serif text-2xl sm:text-3xl text-[#054054] mb-4">Segurança da Informação e Prazos de Retenção</h2>

            <div class="space-y-4 type-body text-sm sm:text-base text-[#536B73]">
              <p>
                Adotamos medidas técnicas, administrativas e físicas aptas a proteger seus dados contra acessos não autorizados, incidentes acidentais ou ilícitos de destruição, perda ou alteração. Nossos protocolos incluem criptografia de ponta a ponta (TLS 1.3), controles rigorosos de privilégios de acesso e acordos estritos de confidencialidade com toda a equipe.
              </p>
              <p>
                Os dados pessoais serão conservados pelo período estritamente necessário para cumprir as finalidades para as quais foram coletados, observados os prazos de guarda previstos na legislação brasileira (Código Civil, Código Tributário Nacional e Código de Defesa do Consumidor).
              </p>
            </div>
          </article>

          <!-- Chapter 6: Canal de Atendimento e Contato -->
          <article class="privacy-chapter p-6 sm:p-8 bg-[#054054] text-white">
            <span class="type-eyebrow text-[#DDA554] block mb-2">06 · Atendimento sobre Privacidade</span>
            <h2 class="font-serif text-2xl sm:text-3xl text-white mb-4">Dúvidas ou Solicitações sobre Dados Pessoais</h2>
            <p class="text-sm text-[#EEF3F5]/90 leading-relaxed mb-6">
              Para exercer qualquer dos seus direitos previstos na LGPD ou esclarecer dúvidas sobre esta Política de Privacidade, entre em contato com nosso atendimento:
            </p>

            <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 bg-white/10 border border-white/20">
              <div>
                <span class="text-[10px] uppercase tracking-wider text-[#DDA554] block mb-1">Telefone de Atendimento</span>
                <span class="font-medium text-base text-white">{{ hotelConfig.phone }}</span>
              </div>
              <a
                routerLink="/contato"
                class="btn-primary bg-[#DDA554] text-[#054054] hover:bg-white transition-colors"
              >
                <span>Página de Contato</span>
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

            <a routerLink="/termos-de-reserva" class="btn-text">
              <span>Consultar Termos de Reserva</span>
              <app-icon name="arrow-right" [size]="13"></app-icon>
            </a>
          </div>

        </div>
      </div>
    </section>
  `
})
export class PrivacyComponent implements OnInit {
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
      title: 'Política de Privacidade & LGPD — Pousada Espírito do Mar',
      description: 'Conheça nossa Política de Privacidade e o tratamento de dados pessoais em total conformidade com a Lei Geral de Proteção de Dados (LGPD, Lei nº 13.709/2018).',
      url: 'https://pousadaespiritodomar.com.br/privacidade'
    });
  }

  private initAnimations(): void {
    const root = this.el.nativeElement as HTMLElement;
    this.motion.createScope(root, () => {
      const header = root.querySelector<HTMLElement>('.privacy-page-header');
      const cards = root.querySelectorAll<HTMLElement>('.privacy-card, .privacy-chapter');

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
