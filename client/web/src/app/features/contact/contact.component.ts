import {
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  afterNextRender,
  computed,
  inject,
  signal
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatSelectModule } from '@angular/material/select';
import { HOTEL_CONFIG } from '../../core/config/hotel-config';
import { SeoService } from '../../core/services/seo.service';
import { IconComponent } from '../../shared/components/icons/icon.component';
import { MotionService } from '../../core/services/motion.service';

interface SelectOption {
  label: string;
  value: string;
}

@Component({
  selector: 'app-contact',
  imports: [DatePipe, FormsModule, IconComponent, MatDatepickerModule, MatSelectModule],
  template: `
    <!-- Header Hero -->
    <header class="contact-page-header relative pt-32 pb-16 sm:pt-36 sm:pb-20 lg:pt-40 lg:pb-24 bg-[#032B38] text-white overflow-hidden">
      <div class="absolute inset-0 z-0">
        <img
          src="https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=2200&q=85"
          alt="Atendimento e contato da Pousada Espírito do Mar em Cabo Frio"
          class="w-full h-full object-cover object-center brightness-[0.42] scale-[1.02]"
        />
        <div class="absolute inset-0 bg-gradient-to-t from-[#032B38] via-[#032B38]/65 to-[#032B38]/30"></div>
      </div>

      <div class="relative z-10 container-editorial text-center flex flex-col items-center">
        <h1 class="font-serif text-4xl sm:text-5xl lg:text-6xl text-white font-normal mb-4 leading-[1.08] max-w-3xl">
          Estamos à disposição para planejar sua estadia
        </h1>
        <p class="text-sm sm:text-base text-[#F7F5F0]/85 font-light max-w-2xl leading-relaxed">
          Fale diretamente com a recepção da Pousada Espírito do Mar para consultar disponibilidade de datas, categorias de quartos e orientações de chegada à Praia do Peró.
        </p>
      </div>
    </header>

    <!-- Quick Highlights Bar -->
    <section class="relative z-20 -mt-8 sm:-mt-10">
      <div class="container-editorial">
        <div class="grid grid-cols-1 md:grid-cols-3 bg-white border border-[#DCE6EA] rounded-xl overflow-hidden shadow-[0_14px_36px_rgba(5,64,84,0.08)] divide-y md:divide-y-0 md:divide-x divide-[#DCE6EA]">
          
          <!-- Highlight 1: Phone -->
          <a
            [href]="'tel:' + hotelConfig.phoneHref"
            class="p-5 sm:p-6 flex items-start gap-4 group hover:bg-[#FCFBF9] transition-colors"
          >
            <div class="w-11 h-11 shrink-0 rounded-lg bg-[#EEF4F6] text-[#054054] group-hover:bg-[#054054] group-hover:text-white transition-colors flex items-center justify-center">
              <app-icon name="phone" [size]="18"></app-icon>
            </div>
            <div>
              <span class="type-eyebrow block text-[10px] text-[#DDA554] mb-1">Telefone da Recepção</span>
              <span class="block font-serif text-xl text-[#054054] font-medium group-hover:text-[#1A6F8A] transition-colors">
                {{ hotelConfig.phone }}
              </span>
              <span class="type-caption block text-[#536B73] mt-0.5">
                Atendimento direto para cotações e reservas
              </span>
            </div>
          </a>

          <!-- Highlight 2: Location -->
          <div class="p-5 sm:p-6 flex items-start gap-4">
            <div class="w-11 h-11 shrink-0 rounded-lg bg-[#EEF4F6] text-[#054054] flex items-center justify-center">
              <app-icon name="map-pin" [size]="18"></app-icon>
            </div>
            <div>
              <span class="type-eyebrow block text-[10px] text-[#DDA554] mb-1">Localização</span>
              <span class="block font-serif text-xl text-[#054054] font-medium">
                Bairro Peró · Cabo Frio, RJ
              </span>
              <span class="type-caption block text-[#536B73] mt-0.5">
                Rua Anequim · CEP {{ hotelConfig.address.zipCode }}
              </span>
            </div>
          </div>

          <!-- Highlight 3: Schedule -->
          <div class="p-5 sm:p-6 flex items-start gap-4">
            <div class="w-11 h-11 shrink-0 rounded-lg bg-[#EEF4F6] text-[#054054] flex items-center justify-center">
              <app-icon name="calendar" [size]="18"></app-icon>
            </div>
            <div>
              <span class="type-eyebrow block text-[10px] text-[#DDA554] mb-1">Horários de Referência</span>
              <span class="block font-serif text-xl text-[#054054] font-medium">
                Check-in 13h · Check-out 11h
              </span>
              <span class="type-caption block text-[#536B73] mt-0.5">
                Confirme condições no ato da reserva
              </span>
            </div>
          </div>

        </div>
      </div>
    </section>

    <!-- Main Contact Section: Channels + Form -->
    <section class="py-16 sm:py-20 lg:py-24 bg-[#F7F5F0]">
      <div class="container-editorial">
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-start">

          <!-- Left Column: Institutional Channels & Map (Col 1-5) -->
          <div class="contact-channels-col lg:col-span-5 flex flex-col space-y-6">
            <div>
              <span class="type-eyebrow text-[#DDA554] block mb-2">Atendimento Personalizado</span>
              <h2 class="type-title text-[#054054] mb-3">Canais Oficiais</h2>
              <p class="type-body text-sm text-[#536B73] leading-relaxed">
                Para garantir informações precisas sobre tarifas, disponibilidade de categorias e regras da hospedagem, utilize sempre nossos canais diretos.
              </p>
            </div>

            <!-- Channel Cards -->
            <div class="space-y-4">
              <!-- Card: Central Telefônica -->
              <div class="bg-white border border-[#DCE6EA] p-5 sm:p-6 shadow-[0_6px_20px_rgba(5,64,84,0.03)]">
                <div class="flex items-start justify-between gap-4 mb-3">
                  <div>
                    <span class="type-eyebrow block text-[10px] text-[#DDA554] mb-1">Canal Preferencial</span>
                    <h3 class="font-serif text-2xl text-[#054054] font-normal">Atendimento Telefônico</h3>
                  </div>
                  <span class="w-9 h-9 rounded-lg bg-[#EEF4F6] text-[#054054] flex items-center justify-center shrink-0">
                    <app-icon name="phone" [size]="16"></app-icon>
                  </span>
                </div>
                <p class="text-xs text-[#536B73] leading-relaxed mb-4">
                  Ideal para confirmação rápida de disponibilidade, valores atualizados por período e orientações para chegada.
                </p>
                <a
                  [href]="'tel:' + hotelConfig.phoneHref"
                  class="inline-flex items-center gap-2 text-sm font-semibold text-[#054054] hover:text-[#1A6F8A] transition-colors"
                >
                  <span>Ligar para {{ hotelConfig.phone }}</span>
                  <app-icon name="arrow-right" [size]="13"></app-icon>
                </a>
              </div>

              <!-- Card: Endereço & Acesso -->
              <div class="bg-white border border-[#DCE6EA] p-5 sm:p-6 shadow-[0_6px_20px_rgba(5,64,84,0.03)]">
                <div class="flex items-start justify-between gap-4 mb-2">
                  <div>
                    <span class="type-eyebrow block text-[10px] text-[#DDA554] mb-1">Endereço no Peró</span>
                    <h3 class="font-serif text-2xl text-[#054054] font-normal">Como Chegar</h3>
                  </div>
                  <span class="w-9 h-9 rounded-lg bg-[#EEF4F6] text-[#054054] flex items-center justify-center shrink-0">
                    <app-icon name="map-pin" [size]="16"></app-icon>
                  </span>
                </div>
                <p class="text-sm text-[#054054] font-medium mb-1">
                  {{ hotelConfig.address.fullFormatted }}
                </p>
                <p class="text-xs text-[#536B73] leading-relaxed mb-4">
                  {{ hotelConfig.address.divergenceNote }}
                </p>

                <!-- Embedded Map Preview -->
                <div class="relative w-full h-48 overflow-hidden rounded-lg border border-[#DCE6EA] bg-[#EEF4F6]">
                  <iframe
                    [src]="safeMapEmbedUrl"
                    title="Mapa de localização da Pousada Espírito do Mar no bairro Peró"
                    class="w-full h-full border-0"
                    loading="lazy"
                    referrerpolicy="no-referrer-when-downgrade"
                    allowfullscreen
                  ></iframe>
                </div>
              </div>
            </div>
          </div>

          <!-- Right Column: Professional Contact Form (Col 6-12) -->
          <div class="contact-form-col contact-material-form lg:col-span-7 bg-white border border-[#DCE6EA] shadow-[0_12px_36px_rgba(5,64,84,0.05)] p-6 sm:p-10 lg:p-12">
            <div class="pb-6 mb-6 sm:mb-8 border-b border-[#DCE6EA] flex flex-col sm:flex-row sm:items-end justify-between gap-4">
              <div>
                <span class="type-eyebrow text-[#DDA554] block mb-2">Formulário de Atendimento</span>
                <h2 class="font-serif text-3xl sm:text-4xl text-[#054054] font-normal">
                  Envie uma mensagem à recepção
                </h2>
              </div>
              <span class="text-xs text-[#536B73]">
                Campos com <strong class="text-[#054054]">*</strong> são obrigatórios
              </span>
            </div>

            @if (!isSubmitted()) {
              <form (submit)="onSubmitForm($event)" class="space-y-6" novalidate>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-5 sm:gap-6">
                  <div>
                    <label for="contact-name" class="type-eyebrow block mb-2 text-[10px] !text-[#054054]">
                      Nome Completo *
                    </label>
                    <input
                      id="contact-name"
                      type="text"
                      [ngModel]="name()"
                      (ngModelChange)="name.set($event)"
                      name="name"
                      required
                      placeholder="Seu nome completo"
                      class="w-full h-[50px] bg-[#FCFBF9] border border-[#DCE6EA] px-4 text-sm text-[#054054] placeholder:text-[#8BA0A8] focus:outline-none focus:border-[#054054] focus:bg-white transition-colors"
                    />
                  </div>

                  <div>
                    <label for="contact-email" class="type-eyebrow block mb-2 text-[10px] !text-[#054054]">
                      E-mail para Retorno *
                    </label>
                    <input
                      id="contact-email"
                      type="email"
                      [ngModel]="email()"
                      (ngModelChange)="email.set($event)"
                      name="email"
                      required
                      placeholder="seuemail@exemplo.com"
                      class="w-full h-[50px] bg-[#FCFBF9] border border-[#DCE6EA] px-4 text-sm text-[#054054] placeholder:text-[#8BA0A8] focus:outline-none focus:border-[#054054] focus:bg-white transition-colors"
                    />
                  </div>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-5 sm:gap-6">
                  <div>
                    <label for="contact-phone" class="type-eyebrow block mb-2 text-[10px] !text-[#054054]">
                      Telefone / Celular (com DDD)
                    </label>
                    <input
                      id="contact-phone"
                      type="tel"
                      inputmode="tel"
                      maxlength="15"
                      [ngModel]="phone()"
                      (ngModelChange)="onPhoneChange($event)"
                      name="phone"
                      placeholder="(00) 00000-0000"
                      class="w-full h-[50px] bg-[#FCFBF9] border border-[#DCE6EA] px-4 text-sm text-[#054054] placeholder:text-[#8BA0A8] focus:outline-none focus:border-[#054054] focus:bg-white transition-colors"
                    />
                  </div>

                  <div>
                    <span id="contact-subject-label" class="type-eyebrow block mb-2 text-[10px] !text-[#054054]">
                      Assunto da Consulta
                    </span>
                    <div class="h-[50px] rounded-lg bg-[#FCFBF9] border border-[#DCE6EA] px-4 flex items-center focus-within:border-[#054054] focus-within:bg-white transition-colors">
                      <mat-select
                        aria-labelledby="contact-subject-label"
                        [ngModel]="subject()"
                        (ngModelChange)="subject.set($event)"
                        name="subject"
                        class="w-full"
                      >
                        @for (opt of subjectOptions; track opt.value) {
                          <mat-option [value]="opt.value">{{ opt.label }}</mat-option>
                        }
                      </mat-select>
                    </div>
                  </div>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-5 sm:gap-6">
                  <div>
                    <label for="contact-checkin" class="type-eyebrow block mb-2 text-[10px] !text-[#054054]">
                      Previsão de Chegada (Opcional)
                    </label>
                    <div
                      class="h-[50px] rounded-lg bg-[#FCFBF9] border border-[#DCE6EA] px-4 flex items-center focus-within:border-[#054054] focus-within:bg-white transition-colors cursor-pointer"
                      (click)="contactCheckInPicker.open()"
                    >
                      <input
                        id="contact-checkin"
                        readonly
                        [matDatepicker]="contactCheckInPicker"
                        [min]="minDate"
                        [ngModel]="preferredCheckIn()"
                        (ngModelChange)="preferredCheckIn.set($event)"
                        name="preferredCheckIn"
                        placeholder="dd/mm/aaaa"
                        aria-label="Previsão de chegada"
                        class="w-full bg-transparent text-sm text-[#054054] placeholder:text-[#8BA0A8] focus:outline-none cursor-pointer"
                      />
                      <mat-datepicker-toggle
                        matIconSuffix
                        [for]="contactCheckInPicker"
                        (click)="$event.stopPropagation()"
                      ></mat-datepicker-toggle>
                      <mat-datepicker
                        #contactCheckInPicker
                        xPosition="start"
                        yPosition="below"
                        panelClass="booking-datepicker-panel"
                      />
                    </div>
                  </div>

                  <div>
                    <span id="contact-guests-label" class="type-eyebrow block mb-2 text-[10px] !text-[#054054]">
                      Quantidade de Hóspedes
                    </span>
                    <div class="h-[50px] rounded-lg bg-[#FCFBF9] border border-[#DCE6EA] px-4 flex items-center focus-within:border-[#054054] focus-within:bg-white transition-colors">
                      <mat-select
                        aria-labelledby="contact-guests-label"
                        [ngModel]="guestsCount()"
                        (ngModelChange)="guestsCount.set($event)"
                        name="guestsCount"
                        class="w-full"
                      >
                        @for (opt of guestOptions; track opt.value) {
                          <mat-option [value]="opt.value">{{ opt.label }}</mat-option>
                        }
                      </mat-select>
                    </div>
                  </div>
                </div>

                <div>
                  <label for="contact-message" class="type-eyebrow block mb-2 text-[10px] !text-[#054054]">
                    Sua Mensagem *
                  </label>
                  <textarea
                    id="contact-message"
                    rows="5"
                    [ngModel]="message()"
                    (ngModelChange)="message.set($event)"
                    name="message"
                    required
                    placeholder="Descreva sua dúvida, período desejado, preferência por quarto com varanda ou outras necessidades da sua estadia..."
                    class="w-full bg-[#FCFBF9] border border-[#DCE6EA] p-4 text-sm text-[#054054] placeholder:text-[#8BA0A8] focus:outline-none focus:border-[#054054] focus:bg-white transition-colors leading-relaxed"
                  ></textarea>
                </div>

                @if (formError()) {
                  <div class="p-3.5 bg-[#FFF8F6] border border-[#C65D47] text-xs text-[#9E3B26]" role="alert">
                    {{ formError() }}
                  </div>
                }

                <div class="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <p class="text-xs text-[#536B73] leading-relaxed max-w-sm">
                    O formulário prepara sua consulta: após revisar, ligue para a recepção e informe os dados — o atendimento da pousada é feito por telefone.
                  </p>

                  <button
                    type="submit"
                    class="btn-primary px-8 py-4 cursor-pointer shrink-0"
                  >
                    <span>Preparar consulta</span>
                    <app-icon name="arrow-right" [size]="13"></app-icon>
                  </button>
                </div>
              </form>
            } @else {
              <div class="p-6 sm:p-8 bg-[#FCFBF9] border border-[#DDA554]/50 flex flex-col">
                <span class="w-12 h-12 rounded-full bg-[#EEF4F6] text-[#1A6F8A] flex items-center justify-center mb-4">
                  <app-icon name="check" [size]="22"></app-icon>
                </span>
                <span class="type-eyebrow text-[#DDA554] block mb-1">Consulta preparada</span>
                <h3 class="font-serif text-2xl sm:text-3xl text-[#054054] mb-3 font-normal">
                  Ligue para a recepção com estes dados
                </h3>
                <p class="type-body text-sm text-[#536B73] mb-5 leading-relaxed">
                  O canal oficial de atendimento da pousada é o telefone <strong class="text-[#054054]">{{ hotelConfig.phone }}</strong>. Leia o resumo abaixo ao atendente para agilizar sua solicitação.
                </p>

                <dl class="text-left text-xs text-[#054054] bg-white border border-[#DCE6EA] p-4 sm:p-5 mb-6 space-y-2">
                  <div class="flex gap-2"><dt class="font-semibold shrink-0 w-28">Nome:</dt><dd>{{ name() }}</dd></div>
                  <div class="flex gap-2"><dt class="font-semibold shrink-0 w-28">E-mail:</dt><dd>{{ email() }}</dd></div>
                  @if (phone()) {
                    <div class="flex gap-2"><dt class="font-semibold shrink-0 w-28">Telefone:</dt><dd>{{ phone() }}</dd></div>
                  }
                  <div class="flex gap-2"><dt class="font-semibold shrink-0 w-28">Assunto:</dt><dd>{{ subjectLabel() }}</dd></div>
                  @if (preferredCheckIn()) {
                    <div class="flex gap-2"><dt class="font-semibold shrink-0 w-28">Chegada prevista:</dt><dd>{{ preferredCheckIn() | date: 'dd/MM/yyyy' }}</dd></div>
                  }
                  <div class="flex gap-2"><dt class="font-semibold shrink-0 w-28">Hóspedes:</dt><dd>{{ guestsLabel() }}</dd></div>
                  <div class="flex gap-2"><dt class="font-semibold shrink-0 w-28">Mensagem:</dt><dd class="whitespace-pre-line">{{ message() }}</dd></div>
                </dl>

                <div class="flex flex-wrap items-center gap-4">
                  <a [href]="'tel:' + hotelConfig.phoneHref" class="btn-primary">
                    <app-icon name="phone" [size]="14"></app-icon>
                    <span>Ligar {{ hotelConfig.phone }}</span>
                  </a>
                  <button
                    type="button"
                    (click)="resetForm()"
                    class="btn-secondary cursor-pointer"
                  >
                    <span>Editar dados</span>
                  </button>
                </div>
              </div>
            }
          </div>

        </div>
      </div>
    </section>

    <!-- Interactive FAQ Section -->
    <section class="py-16 sm:py-20 lg:py-24 bg-[#EEF3F5] border-t border-[#DCE6EA]" aria-labelledby="faq-heading">
      <div class="container-editorial">
        <div class="max-w-4xl mx-auto">

          <div class="text-center mb-10 sm:mb-12">
            <span class="type-eyebrow text-[#DDA554] block mb-2">Dúvidas Frequentes (FAQ)</span>
            <h2 id="faq-heading" class="type-title text-[#054054] mb-3">
              Informações importantes antes da sua reserva
            </h2>
            <p class="type-body text-sm sm:text-base text-[#536B73] max-w-2xl mx-auto">
              Reunimos as principais respostas sobre localização no bairro Peró, horários, comodidades e funcionamento da Pousada Espírito do Mar.
            </p>
          </div>

          <!-- Category Filter Pills -->
          <div class="flex flex-wrap items-center justify-center gap-2 mb-8" role="tablist" aria-label="Filtrar perguntas por tema">
            @for (cat of faqCategories(); track cat) {
              <button
                type="button"
                role="tab"
                [attr.aria-selected]="selectedCategory() === cat"
                (click)="selectedCategory.set(cat)"
                class="px-4 py-2 rounded-lg text-xs uppercase tracking-[0.16em] font-medium border transition-colors cursor-pointer"
                [class.bg-[#054054]]="selectedCategory() === cat"
                [class.text-white]="selectedCategory() === cat"
                [class.border-[#054054]]="selectedCategory() === cat"
                [class.bg-white]="selectedCategory() !== cat"
                [class.text-[#054054]]="selectedCategory() !== cat"
                [class.border-[#DCE6EA]]="selectedCategory() !== cat"
              >
                {{ cat }}
              </button>
            }
          </div>

          <!-- Accordion List -->
          <div class="space-y-3">
            @for (faq of filteredFaqs(); track faq.question; let idx = $index) {
              <article class="bg-white border border-[#DCE6EA] transition-shadow hover:shadow-[0_6px_20px_rgba(5,64,84,0.05)]">
                <h3>
                  <button
                    type="button"
                    (click)="toggleFaq(idx)"
                    [attr.aria-expanded]="openFaqIndex() === idx"
                    class="w-full p-5 sm:p-6 text-left flex items-center justify-between gap-4 cursor-pointer"
                  >
                    <div>
                      <span class="type-eyebrow text-[#DDA554] block mb-1 text-[10px]">
                        {{ faq.category }}
                      </span>
                      <span class="font-serif text-xl sm:text-2xl text-[#054054] font-normal block">
                        {{ faq.question }}
                      </span>
                    </div>
                    <span
                      class="w-8 h-8 shrink-0 rounded-lg border border-[#DCE6EA] text-[#054054] flex items-center justify-center transition-transform duration-300"
                      [class.rotate-180]="openFaqIndex() === idx"
                      [class.bg-[#054054]]="openFaqIndex() === idx"
                      [class.text-white]="openFaqIndex() === idx"
                    >
                      <app-icon name="chevron-down" [size]="16"></app-icon>
                    </span>
                  </button>
                </h3>

                @if (openFaqIndex() === idx) {
                  <div class="px-5 pb-6 sm:px-6 sm:pb-6 pt-1 border-t border-[#DCE6EA]/60">
                    <p class="type-body text-sm text-[#536B73] leading-relaxed">
                      {{ faq.answer }}
                    </p>
                  </div>
                }
              </article>
            }
          </div>

        </div>
      </div>
    </section>
  `
})
export class ContactComponent implements OnInit {
  public readonly hotelConfig = HOTEL_CONFIG;
  public readonly safeMapEmbedUrl: SafeResourceUrl;
  public readonly minDate = new Date();

  private readonly sanitizer = inject(DomSanitizer);
  private readonly seoService = inject(SeoService);
  private readonly el = inject(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly motion = inject(MotionService);

  public readonly name = signal<string>('');
  public readonly email = signal<string>('');
  public readonly phone = signal<string>('');
  public readonly subject = signal<string>('reserva');
  public readonly preferredCheckIn = signal<Date | null>(null);
  public readonly guestsCount = signal<string>('2');
  public readonly message = signal<string>('');
  public readonly formError = signal<string>('');
  public readonly isSubmitted = signal<boolean>(false);

  public readonly subjectOptions: SelectOption[] = [
    { label: 'Consulta de Disponibilidade e Tarifas', value: 'reserva' },
    { label: 'Dúvidas sobre Categorias de Quartos', value: 'acomodacao' },
    { label: 'Estacionamento, Café da Manhã e Estrutura', value: 'estrutura' },
    { label: 'Política para Animais de Estimação', value: 'pets' },
    { label: 'Localização e Como Chegar', value: 'localizacao' },
    { label: 'Outros Assuntos', value: 'outros' }
  ];

  public readonly guestOptions: SelectOption[] = [
    { label: '1 Hóspede', value: '1' },
    { label: '2 Hóspedes', value: '2' },
    { label: '3 Hóspedes', value: '3' },
    { label: '4 Hóspedes ou mais', value: '4' }
  ];

  public readonly subjectLabel = computed(
    () => this.subjectOptions.find((o) => o.value === this.subject())?.label ?? this.subject()
  );

  public readonly guestsLabel = computed(
    () => this.guestOptions.find((o) => o.value === this.guestsCount())?.label ?? this.guestsCount()
  );

  public readonly selectedCategory = signal<string>('Todas');
  public readonly openFaqIndex = signal<number | null>(0);

  public readonly faqCategories = computed<string[]>(() => {
    const categories = new Set<string>(['Todas']);
    for (const item of this.hotelConfig.faqs) {
      categories.add(item.category);
    }
    return Array.from(categories);
  });

  public readonly filteredFaqs = computed(() => {
    const category = this.selectedCategory();
    if (category === 'Todas') {
      return this.hotelConfig.faqs;
    }
    return this.hotelConfig.faqs.filter((f) => f.category === category);
  });

  constructor() {
    this.safeMapEmbedUrl = this.sanitizer.bypassSecurityTrustResourceUrl(
      this.hotelConfig.googleMapsEmbedUrl
    );

    afterNextRender(() => {
      this.initAnimations();
    });
  }

  public ngOnInit(): void {
    this.seoService.updateSeo({
      title: 'Contato & FAQ | Pousada Espírito do Mar no Peró, Cabo Frio',
      description:
        'Entre em contato com a Pousada Espírito do Mar, no bairro Peró, Cabo Frio (RJ). Tire suas dúvidas sobre localização, acomodações, horários e reservas.',
      url: `${HOTEL_CONFIG.siteUrl}/contato`
    });
  }

  public onPhoneChange(rawValue: string): void {
    const digits = rawValue.replace(/\D/g, '').slice(0, 11);
    if (!digits) {
      this.phone.set('');
      return;
    }
    if (digits.length <= 2) {
      this.phone.set(`(${digits}`);
      return;
    }
    if (digits.length <= 6) {
      this.phone.set(`(${digits.slice(0, 2)}) ${digits.slice(2)}`);
      return;
    }
    if (digits.length <= 10) {
      this.phone.set(`(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`);
      return;
    }
    this.phone.set(`(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`);
  }

  public toggleFaq(index: number): void {
    this.openFaqIndex.update((current) => (current === index ? null : index));
  }

  public onSubmitForm(event: Event): void {
    event.preventDefault();
    if (!this.name().trim() || !this.email().trim() || !this.message().trim()) {
      this.formError.set('Por favor, preencha seu nome, e-mail e mensagem antes de enviar.');
      return;
    }

    this.formError.set('');
    this.isSubmitted.set(true);
  }

  public resetForm(): void {
    this.name.set('');
    this.email.set('');
    this.phone.set('');
    this.preferredCheckIn.set(null);
    this.guestsCount.set('2');
    this.message.set('');
    this.formError.set('');
    this.isSubmitted.set(false);
  }

  private initAnimations(): void {
    const root = this.el.nativeElement as HTMLElement;
    this.motion.createScope(
      root,
      () => {
        const header = root.querySelector<HTMLElement>('.contact-page-header');
        const channels = root.querySelector<HTMLElement>('.contact-channels-col');
        const form = root.querySelector<HTMLElement>('.contact-form-col');

        if (header) {
          this.motion.animateScrollReveal(header, { y: 28, duration: 0.85 });
        }

        if (channels) {
          this.motion.animateScrollReveal(channels, { y: 32, duration: 0.9, trigger: channels });
        }

        if (form) {
          this.motion.animateScrollReveal(form, {
            y: 32,
            duration: 0.9,
            delay: 0.1,
            trigger: form
          });
        }
      },
      this.destroyRef
    );
  }
}
