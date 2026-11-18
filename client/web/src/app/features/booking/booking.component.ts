import { Component, afterNextRender, ElementRef, inject, DestroyRef, OnInit, signal, computed } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { BookingService } from '../../core/services/booking.service';
import { PaymentService, TipoPagamento } from '../../core/services/payment.service';
import { AccommodationService } from '../../core/services/accommodation.service';
import { Accommodation } from '../../core/models/accommodation.model';
import { SeoService } from '../../core/services/seo.service';
import { IconComponent } from '../../shared/components/icons/icon.component';
import { HOTEL_CONFIG } from '../../core/config/hotel-config';
import { MotionService } from '../../core/services/motion.service';


@Component({
  selector: 'app-booking',
  imports: [RouterLink, FormsModule, IconComponent],
  template: `
    <header class="booking-page-header relative pt-28 pb-12 sm:pt-32 sm:pb-14 lg:pt-36 lg:pb-16 bg-[#032B38] text-white overflow-hidden">
      <div class="absolute inset-0 z-0">
        <img
          src="https://images.unsplash.com/photo-1566665797739-1674de7a421a?auto=format&fit=crop&w=2200&q=85"
          alt="Consultar disponibilidade na Pousada Espírito do Mar em Cabo Frio"
          class="w-full h-full object-cover object-center filter brightness-[0.5]"
        />
        <div class="absolute inset-0 bg-gradient-to-t from-[#032B38] via-[#032B38]/50 to-transparent"></div>
      </div>

      <div class="relative z-10 container-editorial text-center flex flex-col items-center">
        <h1 class="font-serif text-4xl sm:text-6xl text-white font-normal mb-3 sm:mb-4 leading-tight">
          Consultar Disponibilidade
        </h1>
        <p class="text-sm sm:text-base text-[#F7F5F0]/80 font-light max-w-xl leading-relaxed">
          Informe as datas pretendidas e a categoria de acomodação desejada para consultar disponibilidade e tarifas na Pousada Espírito do Mar.
        </p>
      </div>
    </header>

    <!-- Booking Workflow -->
    <section class="py-12 sm:py-16 lg:py-20 bg-[#F7F5F0]">
      <div class="container-editorial">
        
        @if (!isSuccess()) {
          <div class="booking-workflow-grid grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
            
            <!-- Left: Workflow Steps (Col 1-7) -->
            <div class="lg:col-span-7 flex flex-col gap-6 sm:gap-8">
              
              <!-- Step 1: Dates & Guests -->
              <div class="bg-white p-5 sm:p-7 border border-[#DCE6EA] shadow-sm">
                <span class="type-eyebrow text-[#DDA554] block mb-2">01 · Período</span>
                <h2 class="font-serif text-2xl text-[#054054] mb-4 sm:mb-5">Datas da viagem</h2>

                <div class="grid grid-cols-1 sm:grid-cols-3 gap-5 items-end">
                  <div>
                    <label for="booking-checkin" class="type-eyebrow block mb-1 text-[10px] whitespace-nowrap">Check-in · 13h</label>
                    <input
                      id="booking-checkin"
                      type="date"
                      [ngModel]="checkIn()"
                      (ngModelChange)="checkIn.set($event)"
                      [min]="todayIso"
                      name="checkIn"
                      class="w-full bg-[#F7F5F0] border border-[#DCE6EA] p-3 text-sm text-[#054054] focus:outline-none focus:border-[#054054]"
                    />
                  </div>

                  <div>
                    <label for="booking-checkout" class="type-eyebrow block mb-1 text-[10px] whitespace-nowrap">Check-out · 11h</label>
                    <input
                      id="booking-checkout"
                      type="date"
                      [ngModel]="checkOut()"
                      (ngModelChange)="checkOut.set($event)"
                      [min]="minCheckOutIso()"
                      name="checkOut"
                      class="w-full bg-[#F7F5F0] border border-[#DCE6EA] p-3 text-sm text-[#054054] focus:outline-none focus:border-[#054054]"
                    />
                  </div>

                  <div>
                    <label for="booking-guests" class="type-eyebrow block mb-1 text-[10px] whitespace-nowrap">Hóspedes</label>
                    <select
                      id="booking-guests"
                      [ngModel]="guests()"
                      (ngModelChange)="guests.set($event)"
                      name="guests"
                      class="w-full bg-[#F7F5F0] border border-[#DCE6EA] p-3 text-sm text-[#054054] focus:outline-none focus:border-[#054054]"
                    >
                      <option [value]="1">1 Hóspede</option>
                      <option [value]="2">2 Hóspedes</option>
                      <option [value]="3">3 Hóspedes</option>
                      <option [value]="4">4 Hóspedes</option>
                    </select>
                  </div>
                </div>

                <div class="mt-4 pt-4 border-t border-[#DCE6EA] text-xs text-[#536B73] flex items-center justify-between">
                  <span>Duração:</span>
                  <span class="font-medium text-[#054054]">
                    @if (datesValid()) {
                      {{ calculatedNights() }} {{ calculatedNights() === 1 ? 'diária' : 'diárias' }}
                    } @else {
                      —
                    }
                  </span>
                </div>

                @if (dateError()) {
                  <p class="mt-3 p-3 bg-[#FFF8F6] border border-[#C65D47] text-xs text-[#9E3B26]" role="alert">
                    {{ dateError() }}
                  </p>
                }
              </div>

              <!-- Step 2: Choose Accommodation -->
              <div class="bg-white p-5 sm:p-7 border border-[#DCE6EA] shadow-sm">
                <span class="type-eyebrow text-[#DDA554] block mb-2">02 · Categoria</span>
                <h2 class="font-serif text-2xl text-[#054054] mb-4 sm:mb-5">Escolha a acomodação</h2>

                @if (accommodationService.loading()) {
                  <div class="space-y-3" aria-busy="true" aria-label="Carregando acomodações">
                    @for (ph of [1, 2, 3]; track ph) {
                      <div class="p-4 border border-[#DCE6EA] flex items-center gap-4">
                        <div class="w-16 h-16 bg-[#EEF3F5] animate-pulse rounded"></div>
                        <div class="flex-1 space-y-2">
                          <div class="h-4 w-1/3 bg-[#EEF3F5] animate-pulse rounded"></div>
                          <div class="h-3 w-1/2 bg-[#EEF3F5] animate-pulse rounded"></div>
                        </div>
                      </div>
                    }
                  </div>
                } @else if (accommodationService.accommodations().length === 0) {
                  <p class="type-body text-sm text-[#536B73] p-4 bg-[#EEF3F5] border border-[#DCE6EA]">
                    O catálogo de acomodações está em atualização. Ligue para {{ hotelConfig.phone }} para consultar as categorias disponíveis.
                  </p>
                }

                <div class="space-y-3" role="radiogroup" aria-label="Categorias de acomodação">
                  @for (acc of accommodationService.accommodations(); track acc.id) {
                    <button
                      type="button"
                      role="radio"
                      [attr.aria-checked]="selectedSuiteSlug() === acc.slug"
                      (click)="selectedSuiteSlug.set(acc.slug)"
                      [class]="'w-full text-left p-3.5 sm:p-4 border transition-all duration-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 cursor-pointer ' +
                        (selectedSuiteSlug() === acc.slug
                          ? 'border-[#054054] bg-[#EEF3F5]'
                          : 'border-[#DCE6EA] hover:border-[#054054]/40')"
                    >
                      <div class="flex items-center gap-4">
                        <img [src]="acc.coverImage" [alt]="acc.name + ' (imagem ilustrativa)'" class="w-16 h-16 object-cover flex-shrink-0" />
                        <div>
                          <h3 class="font-serif text-base text-[#054054] font-medium">{{ acc.name }}</h3>
                          <span class="type-caption block text-[#536B73]">{{ acc.view }} · Até {{ acc.guests }} hóspedes</span>
                        </div>
                      </div>

                      <div class="text-right self-end sm:self-center flex-shrink-0">
                        <span class="font-serif text-sm text-[#054054]">
                          {{ acc.priceLabel }}
                        </span>
                      </div>
                    </button>
                  }
                </div>
              </div>

              <!-- Step 3: Guest Contact Information -->
              <div class="bg-white p-5 sm:p-7 border border-[#DCE6EA] shadow-sm">
                <span class="type-eyebrow text-[#DDA554] block mb-2">03 · Seus Dados</span>
                <h2 class="font-serif text-2xl text-[#054054] mb-4 sm:mb-5">Dados para retorno</h2>

                <form (submit)="onSubmitBooking()" class="space-y-4">
                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label for="book-name" class="type-eyebrow block mb-1 text-[10px]">Nome Completo</label>
                      <input
                        id="book-name"
                        type="text"
                        [ngModel]="guestName()"
                        (ngModelChange)="guestName.set($event)"
                        name="guestName"
                        required
                        class="w-full bg-[#F7F5F0] border border-[#DCE6EA] p-3 text-sm text-[#054054] focus:outline-none focus:border-[#054054]"
                      />
                    </div>

                    <div>
                      <label for="book-email" class="type-eyebrow block mb-1 text-[10px]">E-mail</label>
                      <input
                        id="book-email"
                        type="email"
                        [ngModel]="guestEmail()"
                        (ngModelChange)="guestEmail.set($event)"
                        name="guestEmail"
                        required
                        class="w-full bg-[#F7F5F0] border border-[#DCE6EA] p-3 text-sm text-[#054054] focus:outline-none focus:border-[#054054]"
                      />
                    </div>
                  </div>

                  <div>
                    <label for="book-phone" class="type-eyebrow block mb-1 text-[10px]">Telefone (celular/WhatsApp)</label>
                    <div class="flex gap-2">
                      <select
                        id="book-phone-ddi"
                        name="guestPhoneDdi"
                        [ngModel]="guestPhoneDdi()"
                        (ngModelChange)="guestPhoneDdi.set($event)"
                        aria-label="Código do país (DDI)"
                        class="bg-[#F7F5F0] border border-[#DCE6EA] p-3 text-sm text-[#054054] focus:outline-none focus:border-[#054054] w-28 flex-shrink-0"
                      >
                        @for (d of ddiOptions; track d.code) {
                          <option [value]="d.code">{{ d.label }}</option>
                        }
                      </select>
                      <input
                        id="book-phone"
                        type="tel"
                        [ngModel]="guestPhone()"
                        (ngModelChange)="guestPhone.set($event)"
                        name="guestPhone"
                        placeholder="DDD + número, ex.: 85 99999-1234"
                        required
                        class="w-full bg-[#F7F5F0] border border-[#DCE6EA] p-3 text-sm text-[#054054] focus:outline-none focus:border-[#054054]"
                      />
                    </div>
                  </div>

                  <div class="flex flex-col gap-2">
                    <label class="flex items-center gap-2 text-sm text-[#054054] cursor-pointer">
                      <input type="checkbox" [ngModel]="earlyCheckin()" (ngModelChange)="earlyCheckin.set($event)" name="earlyCheckin" class="accent-[#054054]" />
                      Early check-in (entrada antecipada, sujeito à disponibilidade)
                    </label>
                    <label class="flex items-center gap-2 text-sm text-[#054054] cursor-pointer">
                      <input type="checkbox" [ngModel]="lateCheckout()" (ngModelChange)="lateCheckout.set($event)" name="lateCheckout" class="accent-[#054054]" />
                      Late checkout (saída estendida, sujeito à disponibilidade)
                    </label>
                  </div>

                  <div>
                    <label for="book-corporate" class="type-eyebrow block mb-1 text-[10px]">Código corporativo (opcional)</label>
                    <input
                      id="book-corporate"
                      type="text"
                      [ngModel]="codigoCorporativo()"
                      (ngModelChange)="onCodigoChange($event)"
                      name="codigoCorporativo"
                      placeholder="Ex.: ACME2025"
                      autocomplete="off"
                      class="w-full bg-[#F7F5F0] border border-[#DCE6EA] p-3 text-sm text-[#054054] uppercase focus:outline-none focus:border-[#054054]"
                    />
                    @if (descontoCorporativo() !== null) {
                      <p class="text-xs mt-1 text-[#1a6f4a]">Desconto de {{ descontoCorporativo() }}% aplicado na diária.</p>
                    } @else if (codigoInvalido()) {
                      <p class="text-xs mt-1 text-[#536B73]">Código não reconhecido — tarifa padrão aplicada.</p>
                    }
                  </div>

                  <div>
                    <label for="book-requests" class="type-eyebrow block mb-1 text-[10px]">Observações ou Preferências</label>
                    <textarea
                      id="book-requests"
                      rows="3"
                      [ngModel]="specialRequests()"
                      (ngModelChange)="specialRequests.set($event)"
                      name="specialRequests"
                      placeholder="Informe se deseja quarto com varanda, vaga no estacionamento ou outras dúvidas..."
                      class="w-full bg-[#F7F5F0] border border-[#DCE6EA] p-3 text-sm text-[#054054] focus:outline-none focus:border-[#054054] resize-none"
                    ></textarea>
                  </div>

                  <div>
                    <label class="flex items-start gap-2 cursor-pointer text-xs text-[#536B73]">
                      <input type="checkbox" [ngModel]="aceiteTermos()" (ngModelChange)="aceiteTermos.set($event)" name="aceiteTermos" required class="accent-[#054054] mt-0.5" />
                      <span>
                        Li e aceito a <a routerLink="/privacidade" target="_blank" class="underline text-[#054054]">Política de Privacidade</a>
                        e os <a routerLink="/termos-de-reserva" target="_blank" class="underline text-[#054054]">Termos de Reserva</a>,
                        incluindo a política de cancelamento. Autorizo o tratamento dos meus dados
                        para a execução da hospedagem (LGPD 13.709/18).
                      </span>
                    </label>
                    <label class="flex items-start gap-2 cursor-pointer text-xs text-[#536B73] mt-2">
                      <input type="checkbox" [ngModel]="aceiteWhatsapp()" (ngModelChange)="aceiteWhatsapp.set($event)" name="aceiteWhatsapp" class="accent-[#054054] mt-0.5" />
                      <span>
                        Autorizo receber pelo WhatsApp avisos sobre esta reserva
                        (confirmação, status do pagamento e cancelamento) — mensagens
                        transacionais apenas, sem publicidade.
                      </span>
                    </label>
                    <label class="flex items-start gap-2 cursor-pointer text-xs text-[#536B73] mt-2">
                      <input type="checkbox" [ngModel]="aceiteMarketing()" (ngModelChange)="aceiteMarketing.set($event)" name="aceiteMarketing" class="accent-[#054054] mt-0.5" />
                      <span>
                        Aceito receber ofertas e novidades da pousada por e-mail e WhatsApp
                        (opcional — posso descadastrar a qualquer momento).
                      </span>
                    </label>
                  </div>

                  @if (errorMessage()) {
                    <div class="p-3 bg-red-50 border border-red-200 text-red-700 text-xs">
                      {{ errorMessage() }}
                    </div>
                  }

                  <button
                    type="submit"
                    [disabled]="isLoading() || !aceiteTermos()"
                    class="btn-primary w-full mt-2 cursor-pointer"
                  >
                    @if (isLoading()) {
                      <span>Enviando consulta...</span>
                    } @else {
                      <span>Solicitar cotação e disponibilidade</span>
                    }
                  </button>
                </form>
              </div>

            </div>

            <!-- Right: Order Summary (Col 8-12) -->
            <aside class="lg:col-span-5 sticky top-24" aria-label="Resumo da Consulta">
              <div class="bg-white p-5 sm:p-7 border border-[#DCE6EA] shadow-sm">
                <span class="type-eyebrow text-[#DDA554] block mb-2">Resumo da Consulta</span>
                <h3 class="font-serif text-2xl text-[#054054] mb-4 sm:mb-5">Pousada Espírito do Mar</h3>

                @if (selectedAccommodation(); as acc) {
                  <div class="mb-5 pb-5 border-b border-[#DCE6EA]">
                    <img [src]="acc.coverImage" [alt]="acc.name + ' (imagem ilustrativa)'" class="w-full aspect-[16/10] object-cover mb-3" />
                    <h4 class="font-serif text-xl text-[#054054]">{{ acc.name }}</h4>
                    <span class="type-caption block text-[#536B73]">{{ acc.view }} · {{ acc.beds }}</span>
                  </div>

                  <div class="space-y-2 text-xs text-[#536B73] mb-5 pb-5 border-b border-[#DCE6EA]">
                    <div class="flex justify-between">
                      <span>Período:</span>
                      <span class="text-[#054054] font-medium">{{ formatDateBr(checkIn()) }} a {{ formatDateBr(checkOut()) }}</span>
                    </div>
                    <div class="flex justify-between">
                      <span>Diárias:</span>
                      <span class="text-[#054054] font-medium">{{ datesValid() ? calculatedNights() : '—' }}</span>
                    </div>
                    <div class="flex justify-between">
                      <span>Hóspedes:</span>
                      <span class="text-[#054054] font-medium">{{ guests() }}</span>
                    </div>
                    <div class="flex justify-between">
                      <span>Tarifa:</span>
                      <span class="text-[#054054] font-medium">{{ acc.priceLabel }}</span>
                    </div>
                  </div>
                }

                <div class="pt-2 text-center space-y-2">
                  <a
                    [href]="'tel:' + hotelConfig.phoneHref"
                    class="btn-secondary w-full"
                  >
                    <span>Atendimento por Telefone: {{ hotelConfig.phone }}</span>
                  </a>
                  <span class="type-caption block text-[#536B73]">
                    Bairro Peró · Cabo Frio, RJ
                  </span>
                </div>

              </div>
            </aside>

          </div>
        } @else {
          <!-- Confirmation Screen -->
          <div class="max-w-xl mx-auto bg-white p-8 sm:p-12 border border-[#DCE6EA] text-center shadow-sm">
            <span class="w-12 h-12 rounded-full bg-[#054054] text-[#F7F5F0] flex items-center justify-center mx-auto mb-6">
              <app-icon name="check" [size]="22"></app-icon>
            </span>
            <span class="type-eyebrow text-[#DDA554] block mb-2">Reserva &amp; Consulta Registrada</span>
            <h2 class="font-serif text-3xl text-[#054054] mb-4">Agradecemos o seu contato</h2>
            <p class="type-body text-sm max-w-md mx-auto mb-8">
              {{ serverMessage() || ('Registramos seu interesse na categoria ' + (selectedAccommodation()?.name || 'selecionada') + '.') }}
            </p>

            @if (reservaToken()) {
              <!-- Pagamento online — integral ou sinal (30%) -->
              <div class="mb-8 p-5 bg-[#EEF3F5] border border-[#DCE6EA] text-left">
                <span class="type-eyebrow text-[#DDA554] block mb-2">Garanta sua reserva</span>
                <p class="text-xs text-[#536B73] mb-4 leading-relaxed">
                  Sua acomodação fica reservada por <strong>30 minutos</strong>.
                  Confirme agora com cartão ou Pix e tenha a reserva garantida na hora.
                </p>

                @if (estimatedTotal() > 0) {
                  <div class="space-y-2 mb-4">
                    <label class="flex items-start gap-3 p-3 border cursor-pointer"
                      [class]="tipoPagamento() === 'integral' ? 'border-[#054054] bg-white' : 'border-[#DCE6EA]'">
                      <input type="radio" name="tipoPagamento" value="integral"
                        [checked]="tipoPagamento() === 'integral'"
                        (change)="tipoPagamento.set('integral')" class="mt-0.5" />
                      <span class="flex-1">
                        <span class="block text-sm font-medium text-[#054054]">Pagamento integral</span>
                        <span class="block text-xs text-[#536B73]">{{ paymentService.formatCentavos(estimatedTotal()) }}</span>
                      </span>
                    </label>
                    <label class="flex items-start gap-3 p-3 border cursor-pointer"
                      [class]="tipoPagamento() === 'sinal' ? 'border-[#054054] bg-white' : 'border-[#DCE6EA]'">
                      <input type="radio" name="tipoPagamento" value="sinal"
                        [checked]="tipoPagamento() === 'sinal'"
                        (change)="tipoPagamento.set('sinal')" class="mt-0.5" />
                      <span class="flex-1">
                        <span class="block text-sm font-medium text-[#054054]">Sinal de 30% agora</span>
                        <span class="block text-xs text-[#536B73]">{{ paymentService.formatCentavos(estimatedTotal() * 0.3) }} — restante no check-in</span>
                      </span>
                    </label>
                  </div>
                }

                @if (paymentError()) {
                  <div class="p-3 bg-red-50 border border-red-200 text-red-700 text-xs mb-3">
                    {{ paymentError() }}
                  </div>
                }

                <button
                  type="button"
                  (click)="pagarAgora()"
                  [disabled]="isPaying()"
                  class="btn-primary w-full cursor-pointer"
                >
                  @if (isPaying()) {
                    <span>Redirecionando ao pagamento seguro…</span>
                  } @else {
                    <span>Pagar agora — cartão ou Pix</span>
                  }
                </button>
                <p class="type-caption text-center text-[#536B73] mt-2">
                  Ambiente seguro Stripe · Ou pague na recepção no check-in
                </p>
              </div>
            }

            <div class="flex flex-col sm:flex-row items-center justify-center gap-4">
              <a
                routerLink="/"
                class="btn-primary"
              >
                Voltar ao Início
              </a>
              <a
                [href]="'tel:' + hotelConfig.phoneHref"
                class="btn-secondary"
              >
                Ligar: {{ hotelConfig.phone }}
              </a>
            </div>
          </div>
        }

      </div>
    </section>
  `
})
export class BookingComponent implements OnInit {
  public readonly hotelConfig = HOTEL_CONFIG;
  private readonly route = inject(ActivatedRoute);
  public readonly bookingService = inject(BookingService);
  public readonly paymentService = inject(PaymentService);
  public readonly accommodationService = inject(AccommodationService);
  private readonly seoService = inject(SeoService);
  private readonly el = inject(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly motion = inject(MotionService);

  public readonly checkIn = signal<string>(this.bookingService.filter().checkIn);
  public readonly checkOut = signal<string>(this.bookingService.filter().checkOut);
  public readonly guests = signal<number>(this.bookingService.filter().guests);
  public readonly selectedSuiteSlug = signal<string>('quarto-duplo-standard');

  public readonly codigoCorporativo = signal<string>('');
  public readonly descontoCorporativo = signal<number | null>(null);
  public readonly codigoInvalido = signal<boolean>(false);
  private codigoTimer: ReturnType<typeof setTimeout> | null = null;

  public readonly guestName = signal<string>('');
  public readonly guestEmail = signal<string>('');
  public readonly guestPhone = signal<string>('');
  public readonly guestPhoneDdi = signal<string>('55');
  /** DDI: países de origem mais comuns dos hóspedes — Brasil primeiro. */
  public readonly ddiOptions = [
    { code: '55', label: '+55 BR' },
    { code: '1', label: '+1 US/CA' },
    { code: '351', label: '+351 PT' },
    { code: '34', label: '+34 ES' },
    { code: '44', label: '+44 UK' },
    { code: '49', label: '+49 DE' },
    { code: '33', label: '+33 FR' },
    { code: '39', label: '+39 IT' },
    { code: '46', label: '+46 SE' },
    { code: '47', label: '+47 NO' },
    { code: '54', label: '+54 AR' },
    { code: '598', label: '+598 UY' },
    { code: '595', label: '+595 PY' },
    { code: '56', label: '+56 CL' },
    { code: '57', label: '+57 CO' },
    { code: '52', label: '+52 MX' },
  ];
  public readonly specialRequests = signal<string>('');
  public readonly earlyCheckin = signal<boolean>(false);
  public readonly lateCheckout = signal<boolean>(false);
  public readonly aceiteTermos = signal<boolean>(false);
  public readonly aceiteMarketing = signal<boolean>(false);
  public readonly aceiteWhatsapp = signal<boolean>(true);
  public readonly isLoading = signal<boolean>(false);
  public readonly isSuccess = signal<boolean>(false);
  public readonly serverMessage = signal<string>('');
  public readonly errorMessage = signal<string>('');

  // Pagamento online — token opaco da reserva criada + escolha do tipo.
  public readonly reservaToken = signal<string | null>(null);
  public readonly tipoPagamento = signal<TipoPagamento>('integral');
  public readonly isPaying = signal<boolean>(false);
  public readonly paymentError = signal<string>('');

  constructor() {
    afterNextRender(() => {
      this.initAnimations();
    });
  }

  public readonly todayIso = this.toIsoDate(new Date());

  public readonly minCheckOutIso = computed(() => {
    const base = this.checkIn() || this.todayIso;
    const d = new Date(`${base}T00:00:00`);
    d.setDate(d.getDate() + 1);
    return this.toIsoDate(d);
  });

  /** Datas válidas: ambas preenchidas, check-in não no passado, saída após entrada. */
  public readonly datesValid = computed(() => {
    const ci = this.checkIn();
    const co = this.checkOut();
    if (!ci || !co) return false;
    const start = new Date(`${ci}T00:00:00`).getTime();
    const end = new Date(`${co}T00:00:00`).getTime();
    if (Number.isNaN(start) || Number.isNaN(end)) return false;
    const today = new Date(`${this.todayIso}T00:00:00`).getTime();
    return start >= today && end > start;
  });

  public readonly dateError = computed(() => {
    const ci = this.checkIn();
    const co = this.checkOut();
    if (!ci || !co) return 'Informe as datas de check-in e check-out para consultar a disponibilidade.';
    const start = new Date(`${ci}T00:00:00`).getTime();
    const end = new Date(`${co}T00:00:00`).getTime();
    if (Number.isNaN(start) || Number.isNaN(end)) return 'As datas informadas não são válidas.';
    const today = new Date(`${this.todayIso}T00:00:00`).getTime();
    if (start < today) return 'A data de check-in não pode ser anterior a hoje.';
    if (end <= start) return 'A data de check-out deve ser posterior à data de check-in.';
    return '';
  });

  public readonly calculatedNights = computed(() => {
    if (!this.datesValid()) return 0;
    const start = new Date(`${this.checkIn()}T00:00:00`).getTime();
    const end = new Date(`${this.checkOut()}T00:00:00`).getTime();
    return Math.ceil((end - start) / (1000 * 60 * 60 * 24));
  });

  public readonly selectedAccommodation = computed<Accommodation | undefined>(() => {
    return this.accommodationService.getBySlug(this.selectedSuiteSlug()) || this.accommodationService.accommodations()[0];
  });

  private toIsoDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  public formatDateBr(iso: string): string {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }

  public ngOnInit(): void {
    this.seoService.updateSeo({
      title: 'Consultar Disponibilidade | Pousada Espírito do Mar, Cabo Frio',
      description: 'Consulte a disponibilidade de hospedagem na Pousada Espírito do Mar, localizada no bairro Peró, em Cabo Frio (RJ).',
      url: `${HOTEL_CONFIG.siteUrl}/reservar`
    });

    this.route.queryParamMap.subscribe((params) => {
      const suite = params.get('suite');
      const checkIn = params.get('checkIn');
      const checkOut = params.get('checkOut');
      const guests = params.get('guests');

      if (suite) this.selectedSuiteSlug.set(suite);
      if (checkIn) this.checkIn.set(checkIn);
      if (checkOut) this.checkOut.set(checkOut);
      if (guests) this.guests.set(Number(guests));
    });
  }

  public async onSubmitBooking(): Promise<void> {
    if (this.isLoading()) return;
    if (!this.datesValid()) {
      this.errorMessage.set(this.dateError());
      return;
    }
    if (!this.guestName() || !this.guestEmail() || !this.guestPhone()) return;

    const acc = this.selectedAccommodation();
    if (!acc) {
      this.errorMessage.set('Selecione uma categoria de acomodação para continuar.');
      return;
    }

    this.isLoading.set(true);
    this.errorMessage.set('');

    const resp = await this.bookingService.submitBookingRequest({
      checkIn: this.checkIn(),
      checkOut: this.checkOut(),
      guests: this.guests(),
      accommodationSlug: acc.slug,
      accommodationName: acc.name,
      guestName: this.guestName(),
      guestEmail: this.guestEmail(),
      guestPhone: this.guestPhone(),
      guestPhoneDdi: this.guestPhoneDdi(),
      specialRequests: this.specialRequests(),
      codigoCorporativo: this.descontoCorporativo() !== null
        ? this.codigoCorporativo().trim().toUpperCase()
        : undefined,
      earlyCheckin: this.earlyCheckin(),
      lateCheckout: this.lateCheckout(),
      aceitoTermos: this.aceiteTermos(),
      aceitoMarketing: this.aceiteMarketing(),
      aceitoWhatsapp: this.aceiteWhatsapp(),
      totalNights: this.calculatedNights(),
      estimatedTotal: acc.price ? acc.price * this.calculatedNights() : undefined
    });

    this.isLoading.set(false);
    if (resp.success) {
      this.serverMessage.set(resp.message);
      this.reservaToken.set(resp.token ?? null);
      this.isSuccess.set(true);
    } else {
      this.errorMessage.set(resp.message);
    }
  }

  /** Estimativa exibida ao hóspede — o valor cobrado é recalculado no servidor. */
  public readonly estimatedTotal = computed(() => {
    const acc = this.selectedAccommodation();
    if (!acc?.price) return 0;
    const desc = this.descontoCorporativo();
    const fator = desc !== null ? 1 - desc / 100 : 1;
    return Math.round(acc.price * this.calculatedNights() * fator * 100);
  });

  /** Valida o código corporativo com debounce — desconto só se vigente. */
  public onCodigoChange(valor: string): void {
    this.codigoCorporativo.set(valor);
    this.descontoCorporativo.set(null);
    this.codigoInvalido.set(false);
    if (this.codigoTimer) clearTimeout(this.codigoTimer);
    const codigo = valor.trim();
    if (codigo.length < 4) return;
    this.codigoTimer = setTimeout(() => this.validarCodigo(codigo), 500);
  }

  private async validarCodigo(codigo: string): Promise<void> {
    const data = await this.bookingService.validarContrato(codigo);
    // Só aplica se o campo ainda tiver o mesmo código (digitação posterior).
    if (codigo !== this.codigoCorporativo().trim()) return;
    if (data?.valido && typeof data.desconto_pct === 'number') {
      this.descontoCorporativo.set(data.desconto_pct);
      this.codigoInvalido.set(false);
    } else {
      this.descontoCorporativo.set(null);
      this.codigoInvalido.set(data !== null);
    }
  }

  /** Cria a sessão Stripe e redireciona o hóspede ao checkout hospedado. */
  public async pagarAgora(): Promise<void> {
    const token = this.reservaToken();
    if (!token || this.isPaying()) return;
    this.isPaying.set(true);
    this.paymentError.set('');
    const out = await this.paymentService.criarCheckout(token, this.tipoPagamento());
    if (!out?.checkout_url) {
      this.isPaying.set(false);
      this.paymentError.set(
        'Não foi possível iniciar o pagamento agora. Tente novamente ou reserve e pague na recepção.'
      );
      return;
    }
    window.location.href = out.checkout_url;
  }

  private initAnimations(): void {
    const root = this.el.nativeElement as HTMLElement;
    this.motion.createScope(root, () => {
      const header = root.querySelector<HTMLElement>('.booking-page-header');
      const workflow = root.querySelector<HTMLElement>('.booking-workflow-grid');

      if (header) {
        this.motion.animateScrollReveal(header, { y: 28, duration: 0.85 });
      }

      if (workflow) {
        this.motion.animateScrollReveal(workflow, { y: 24, duration: 0.8, delay: 0.1, trigger: workflow });
      }
    }, this.destroyRef);
  }
}
